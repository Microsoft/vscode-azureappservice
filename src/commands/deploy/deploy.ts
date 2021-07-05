/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { WebSiteManagementModels } from '@azure/arm-appservice';
import { pathExists } from 'fs-extra';
import * as path from 'path';
import * as vscode from 'vscode';
import * as appservice from 'vscode-azureappservice';
import { getDeployFsPath, getDeployNode, IDeployContext, IDeployPaths, showDeployConfirmation } from 'vscode-azureappservice';
import { IActionContext, parseError } from 'vscode-azureextensionui';
import * as constants from '../../constants';
import { ext } from '../../extensionVariables';
import { localize } from '../../localize';
import { SiteTreeItem } from '../../tree/SiteTreeItem';
import { WebAppTreeItem } from '../../tree/WebAppTreeItem';
import { javaUtils } from '../../utils/javaUtils';
import { nonNullValue } from '../../utils/nonNull';
import { isPathEqual } from '../../utils/pathUtils';
import { getRandomHexString } from "../../utils/randomUtils";
import { getWorkspaceSetting } from '../../vsCodeConfig/settings';
import { LinuxRuntimes } from '../createWebApp/LinuxRuntimes';
import { runPostDeployTask } from '../postDeploy/runPostDeployTask';
import { failureMoreInfoSurvey } from './failureMoreInfoSurvey';
import { promptScmDoBuildDeploy } from './promptScmDoBuildDeploy';
import { promptToSaveDeployDefaults } from './promptToSaveDeployDefaults';
import { runPreDeployTask } from './runPreDeployTask';
import { setPreDeployConfig } from './setPreDeployConfig';
import { showDeployCompletedMessage } from './showDeployCompletedMessage';

const postDeployCancelTokens: Map<string, vscode.CancellationTokenSource> = new Map<string, vscode.CancellationTokenSource>();

export async function deploy(actionContext: IActionContext, arg1?: vscode.Uri | SiteTreeItem, arg2?: (vscode.Uri | SiteTreeItem)[], isNewApp: boolean = false): Promise<void> {
    actionContext.telemetry.properties.deployedWithConfigs = 'false';
    let siteConfig: WebSiteManagementModels.SiteConfigResource | undefined;

    if (arg1 instanceof SiteTreeItem) {
        // we can only get the siteConfig earlier if the entry point was a treeItem
        siteConfig = await arg1.root.client.getSiteConfig();
    }

    const fileExtensions: string | string[] | undefined = await javaUtils.getJavaFileExtensions(siteConfig);

    const deployPaths: IDeployPaths = await getDeployFsPath(actionContext, arg1, fileExtensions?.concat('xml'));
    const context: IDeployContext = Object.assign(actionContext, deployPaths, { defaultAppSetting: constants.configurationSettings.defaultWebAppToDeploy, isNewApp });

    // because this is workspace dependant, do it before user selects app
    await setPreDeployConfig(context);
    const node: SiteTreeItem = await getDeployNode(context, ext.tree, arg1, arg2, [WebAppTreeItem.contextValue]);

    const correlationId: string = getRandomHexString();
    context.telemetry.properties.correlationId = correlationId;

    // if we already got siteConfig, don't waste time getting it again
    siteConfig = siteConfig ? siteConfig : await node.root.client.getSiteConfig();

    if (javaUtils.isJavaRuntime(siteConfig)) {
        await javaUtils.configureJavaSEAppSettings(node);
    }

    const isZipDeploy: boolean = siteConfig.scmType !== constants.ScmType.LocalGit && siteConfig !== constants.ScmType.GitHub;
    // only check enableScmDoBuildDuringDeploy if currentWorkspace matches the workspace being deployed as a user can "Browse" to a different project
    if (getWorkspaceSetting<boolean>(constants.configurationSettings.showBuildDuringDeployPrompt, context.effectiveDeployFsPath)) {
        const remoteSettings: WebSiteManagementModels.StringDictionary = await node.client.listApplicationSettings();
        const hasSCMDoBuildSetting: boolean = !!remoteSettings.properties && 'SCM_DO_BUILD_DURING_DEPLOYMENT' in remoteSettings.properties;
        //check if node is being zipdeployed and that there is no .deployment file
        if (!hasSCMDoBuildSetting && siteConfig.linuxFxVersion && isZipDeploy && !(await pathExists(path.join(context.effectiveDeployFsPath, constants.deploymentFileName)))) {
            const linuxFxVersion: string = siteConfig.linuxFxVersion.toLowerCase();
            if (linuxFxVersion.startsWith(LinuxRuntimes.node)) {
                // if it is node or python, prompt the user (as we can break them)
                await promptScmDoBuildDeploy(context, context.effectiveDeployFsPath, LinuxRuntimes.node);
            } else if (linuxFxVersion.startsWith(LinuxRuntimes.python)) {
                await promptScmDoBuildDeploy(context, context.effectiveDeployFsPath, LinuxRuntimes.python);
            }
        }
    }

    if (getWorkspaceSetting<boolean>('showDeployConfirmation', context.workspaceFolder.uri.fsPath) && !context.isNewApp && isZipDeploy) {
        await showDeployConfirmation(context, node.client, 'appService.Deploy');
    }

    void promptToSaveDeployDefaults(context, node, context.workspaceFolder.uri.fsPath, context.effectiveDeployFsPath);
    await runPreDeployTask(context, siteConfig);

    // cancellation moved to after prompts while gathering telemetry
    // cancel the previous detector check from the same web app
    const previousTokenSource: vscode.CancellationTokenSource | undefined = postDeployCancelTokens.get(node.id);
    if (previousTokenSource) {
        previousTokenSource.cancel();
    }

    // only respect the deploySubpath settings for zipdeploys
    const deployPath: string = isZipDeploy ? context.effectiveDeployFsPath : context.originalDeployFsPath;

    if (!isZipDeploy && isPathEqual(context.effectiveDeployFsPath, context.originalDeployFsPath)) {
        const noSubpathWarning: string = localize('ignoreSuppath', 'WARNING: Ignoring deploySubPath "{0}" for non-zip deploy.', getWorkspaceSetting(constants.configurationSettings.deploySubpath));
        ext.outputChannel.appendLog(noSubpathWarning);
    }

    await node.runWithTemporaryDescription(context, localize('deploying', "Deploying..."), async () => {
        try {
            await appservice.deploy(nonNullValue(node).root.client, <string>deployPath, context);
        } catch (error) {
            if (!actionContext.errorHandling.suppressDisplay
                && failureMoreInfoSurvey(parseError(error), nonNullValue(siteConfig))) {
                actionContext.errorHandling.suppressDisplay = true;
            }
            throw error;
        }
    });

    const tokenSource: vscode.CancellationTokenSource = new vscode.CancellationTokenSource();
    postDeployCancelTokens.set(node.id, tokenSource);

    showDeployCompletedMessage(context, node);

    runPostDeployTask(context, node, correlationId, tokenSource);
}
