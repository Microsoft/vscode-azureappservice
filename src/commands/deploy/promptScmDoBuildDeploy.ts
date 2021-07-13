/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fse from 'fs-extra';
import * as path from 'path';
import { MessageItem } from "vscode";
import { DialogResponses, IActionContext } from "vscode-azureextensionui";
import * as constants from '../../constants';
import { localize } from '../../localize';
import { venvUtils } from '../../utils/venvUtils';
import { getWorkspaceSetting, updateWorkspaceSetting } from "../../vsCodeConfig/settings";
import { LinuxRuntimes } from '../createWebApp/LinuxRuntimes';

export async function promptScmDoBuildDeploy(context: IActionContext, fsPath: string, runtime: string): Promise<void> {
    context.telemetry.properties.enableScmInput = "Canceled";

    const learnMoreLink: string = 'https://aka.ms/Kwwkbd';

    const buildDuringDeploy: string = localize('buildDuringDeploy', 'Would you like to update your workspace configuration to run build commands on the target server? This should improve deployment performance.');
    const input: MessageItem | undefined = await context.ui.showWarningMessage(buildDuringDeploy, { modal: true, learnMoreLink, stepName: 'buildDuringDeploy' }, DialogResponses.yes, DialogResponses.no);

    if (input === DialogResponses.yes) {
        await enableScmDoBuildDuringDeploy(fsPath, runtime);
        context.telemetry.properties.enableScmInput = "Yes";
    } else {
        await updateWorkspaceSetting(constants.configurationSettings.showBuildDuringDeployPrompt, false, fsPath);
        context.telemetry.properties.enableScmInput = "No";
    }
}

export async function enableScmDoBuildDuringDeploy(fsPath: string, runtime: string): Promise<void> {
    const zipIgnoreFolders: string[] = await getIgnoredFoldersForDeployment(fsPath, runtime);
    let oldSettings: string[] | string | undefined = getWorkspaceSetting(constants.configurationSettings.zipIgnorePattern, fsPath);
    if (!oldSettings) {
        oldSettings = [];
    } else if (typeof oldSettings === "string") {
        oldSettings = [oldSettings];
        // settings have to be an array to concat the proper zipIgnoreFolders
    }
    const newSettings: string[] = oldSettings;
    for (const folder of zipIgnoreFolders) {
        if (oldSettings.indexOf(folder) < 0) {
            newSettings.push(folder);
        }
    }
    await updateWorkspaceSetting(constants.configurationSettings.zipIgnorePattern, newSettings, fsPath);
    await fse.writeFile(path.join(fsPath, constants.deploymentFileName), constants.deploymentFile);
}

async function getIgnoredFoldersForDeployment(fsPath: string, runtime: string): Promise<string[]> {
    let ignoredFolders: string[];
    switch (runtime) {
        case LinuxRuntimes.node:
            ignoredFolders = ['node_modules{,/**}'];
            break;
        case LinuxRuntimes.python:
            let venvFsPaths: string[];
            try {
                venvFsPaths = (await venvUtils.getExistingVenvs(fsPath)).map(venvPath => `${venvPath}{,/**}`);
            } catch (error) {
                // if there was an error here, don't block-- just assume none could be detected
                venvFsPaths = [];
            }

            // list of Python ignorables are pulled from here https://github.com/github/gitignore/blob/master/Python.gitignore
            // Byte-compiled / optimized / DLL files
            ignoredFolders = ['__pycache__{,/**}', '*.py[cod]', '*$py.class',
                // Distribution / packaging
                '.Python{,/**}', 'build{,/**}', 'develop-eggs{,/**}', 'dist{,/**}', 'downloads{,/**}', 'eggs{,/**}', '.eggs{,/**}', 'lib{,/**}', 'lib64{,/**}', 'parts{,/**}', 'sdist{,/**}', 'var{,/**}',
                'wheels{,/**}', 'share/python-wheels{,/**}', '*.egg-info{,/**}', '.installed.cfg', '*.egg', 'MANIFEST'];

            // Virtual Environments
            const defaultVenvPaths: string[] = ['.env{,/**}', '.venv{,/**}', 'env{,/**}', 'venv{,/**}', 'ENV{,/**}', 'env.bak{,/**}', 'venv.bak{,/**}'];
            for (const venvPath of venvFsPaths) {
                // don't add duplicates
                if (!defaultVenvPaths.find(p => p === venvPath)) {
                    defaultVenvPaths.push(venvPath);
                }
            }

            ignoredFolders = ignoredFolders.concat(defaultVenvPaths);
            break;
        default:
            ignoredFolders = [];
    }

    // add .vscode to the ignorePattern since it will never be needed for deployment
    ignoredFolders.push('.vscode{,/**}');
    return ignoredFolders;
}
