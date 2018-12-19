/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as WebSiteModels from 'azure-arm-website/lib/models';
import * as fse from 'fs-extra';
import * as opn from 'opn';
import * as path from 'path';
import { MessageItem, Uri, window, workspace, WorkspaceConfiguration } from 'vscode';
import { AppSettingsTreeItem, AppSettingTreeItem, deleteSite, DeploymentsTreeItem, DeploymentTreeItem, ISiteTreeRoot, SiteClient } from 'vscode-azureappservice';
import { AzureParentTreeItem, AzureTreeItem, DialogResponses, TelemetryProperties } from 'vscode-azureextensionui';
import { runtimes, toggleValueVisibilityCommandId } from '../constants';
import * as constants from '../constants';
import { ext } from '../extensionVariables';
import { ConnectionsTreeItem } from './ConnectionsTreeItem';
import { CosmosDBConnection } from './CosmosDBConnection';
import { CosmosDBTreeItem } from './CosmosDBTreeItem';
import { FolderTreeItem } from './FolderTreeItem';
import { WebJobsTreeItem } from './WebJobsTreeItem';

export abstract class SiteTreeItem extends AzureParentTreeItem<ISiteTreeRoot> {
    public readonly abstract contextValue: string;
    public readonly abstract label: string;

    public readonly appSettingsNode: AppSettingsTreeItem;
    public deploymentsNode: DeploymentsTreeItem | undefined;

    private readonly _connectionsNode: ConnectionsTreeItem;
    private readonly _folderNode: FolderTreeItem;
    private readonly _logFolderNode: FolderTreeItem;
    private readonly _webJobsNode: WebJobsTreeItem;

    private readonly _root: ISiteTreeRoot;
    private _state?: string;

    constructor(parent: AzureParentTreeItem, client: SiteClient) {
        super(parent);
        this._root = Object.assign({}, parent.root, { client });
        this._state = client.initialState;

        this.appSettingsNode = new AppSettingsTreeItem(this, toggleValueVisibilityCommandId);
        this._connectionsNode = new ConnectionsTreeItem(this);
        this._folderNode = new FolderTreeItem(this, 'Files', "/site/wwwroot");
        this._logFolderNode = new FolderTreeItem(this, 'Logs', '/LogFiles', 'logFolder');
        this._webJobsNode = new WebJobsTreeItem(this);
    }

    public get root(): ISiteTreeRoot {
        return this._root;
    }

    public get description(): string | undefined {
        return this._state && this._state.toLowerCase() !== 'running' ? this._state : undefined;
    }

    public get logStreamLabel(): string {
        return this.root.client.fullName;
    }

    public async refreshLabelImpl(): Promise<void> {
        try {
            this._state = await this.root.client.getState();
        } catch {
            this._state = 'Unknown';
        }
    }

    public hasMoreChildrenImpl(): boolean {
        return false;
    }

    public get id(): string {
        return this.root.client.id;
    }

    public browse(): void {
        // tslint:disable-next-line:no-unsafe-any
        opn(this.root.client.defaultHostUrl);
    }

    public async loadMoreChildrenImpl(_clearCache: boolean): Promise<AzureTreeItem<ISiteTreeRoot>[]> {
        const siteConfig: WebSiteModels.SiteConfig = await this.root.client.getSiteConfig();
        this.deploymentsNode = new DeploymentsTreeItem(this, siteConfig, 'appService.ConnectToGitHub');
        return [this.appSettingsNode, this._connectionsNode, this.deploymentsNode, this._folderNode, this._logFolderNode, this._webJobsNode];
    }

    public pickTreeItemImpl(expectedContextValue: string): AzureTreeItem<ISiteTreeRoot> | undefined {
        switch (expectedContextValue) {
            case AppSettingsTreeItem.contextValue:
            case AppSettingTreeItem.contextValue:
                return this.appSettingsNode;
            case ConnectionsTreeItem.contextValue:
            case CosmosDBTreeItem.contextValueInstalled:
            case CosmosDBTreeItem.contextValueNotInstalled:
            case CosmosDBConnection.contextValue:
                return this._connectionsNode;
            case DeploymentsTreeItem.contextValueConnected:
            case DeploymentsTreeItem.contextValueUnconnected:
            case DeploymentTreeItem.contextValue:
                return this.deploymentsNode;
            case FolderTreeItem.contextValue:
                return this._folderNode;
            case WebJobsTreeItem.contextValue:
                return this._webJobsNode;
            default:
                return undefined;
        }
    }

    public async deleteTreeItemImpl(): Promise<void> {
        await deleteSite(this.root.client);
    }

    public async isHttpLogsEnabled(): Promise<boolean> {
        const logsConfig: WebSiteModels.SiteLogsConfig = await this.root.client.getLogsConfig();
        return !!(logsConfig.httpLogs && logsConfig.httpLogs.fileSystem && logsConfig.httpLogs.fileSystem.enabled);
    }

    public async enableHttpLogs(): Promise<void> {
        const logsConfig: WebSiteModels.SiteLogsConfig = {
            httpLogs: {
                fileSystem: {
                    enabled: true,
                    retentionInDays: 7,
                    retentionInMb: 35
                }
            }
        };

        await this.root.client.updateLogsConfig(logsConfig);
    }

    public async promptScmDoBuildDeploy(fsPath: string, runtime: string, telemetryProperties: TelemetryProperties): Promise<void> {
        const yesButton: MessageItem = { title: 'Yes' };
        const dontShowAgainButton: MessageItem = { title: "No, and don't show again" };
        const learnMoreButton: MessageItem = { title: 'Learn More' };
        const buildDuringDeploy: string = `Would you like to update your workspace configuration to run build commands on the target server? This should improve deployment performance.`;
        let input: MessageItem | undefined = learnMoreButton;
        while (input === learnMoreButton) {
            input = await window.showInformationMessage(buildDuringDeploy, yesButton, dontShowAgainButton, learnMoreButton);
            if (input === learnMoreButton) {
                // tslint:disable-next-line:no-unsafe-any
                opn('https://aka.ms/Kwwkbd');
            }
        }
        if (input === yesButton) {
            await this.enableScmDoBuildDuringDeploy(fsPath, runtime);
            telemetryProperties.enableScmInput = "Yes";
        } else {
            workspace.getConfiguration(constants.extensionPrefix, Uri.file(fsPath)).update(constants.configurationSettings.showBuildDuringDeployPrompt, false);
            telemetryProperties.enableScmInput = "No, and don't show again";
        }

        if (!telemetryProperties.enableScmInput) {
            telemetryProperties.enableScmInput = "Canceled";
        }
    }

    public async enableScmDoBuildDuringDeploy(fsPath: string, runtime: string): Promise<void> {
        const zipIgnoreFolders: string[] = this.getIgnoredFoldersForDeployment(runtime);
        let oldSettings: string[] | string | undefined = workspace.getConfiguration(constants.extensionPrefix, Uri.file(fsPath)).get(constants.configurationSettings.zipIgnorePattern);
        if (!oldSettings) {
            oldSettings = [];
        } else if (typeof oldSettings === "string") {
            oldSettings = [oldSettings];
            // settings have to be an array to concat the proper zipIgnoreFolders
        }
        const newSettings: string[] = oldSettings;
        for (const folder of zipIgnoreFolders) {
            const globIndex: number = folder.indexOf('{,/**}');
            // remove the glob pattern to verify the folder exists within the project
            const nonGlobFolder: string = globIndex < 0 ? folder : folder.substring(0, globIndex);
            if (oldSettings.indexOf(folder) < 0 && await fse.pathExists(path.join(fsPath, nonGlobFolder))) {
                newSettings.push(folder);
            }
        }
        workspace.getConfiguration(constants.extensionPrefix, Uri.file(fsPath)).update(constants.configurationSettings.zipIgnorePattern, newSettings);
        await fse.writeFile(path.join(fsPath, constants.deploymentFileName), constants.deploymentFile);
    }

    public async promptToSaveDeployDefaults(workspacePath: string, deployPath: string, telemetryProperties: TelemetryProperties): Promise<void> {
        const saveDeploymentConfig: string = `Always deploy the workspace "${path.basename(workspacePath)}" to "${this.root.client.fullName}"?`;
        const dontShowAgain: MessageItem = { title: "Don't show again" };
        const workspaceConfiguration: WorkspaceConfiguration = workspace.getConfiguration(constants.extensionPrefix, Uri.file(deployPath));
        const result: MessageItem = await ext.ui.showWarningMessage(saveDeploymentConfig, DialogResponses.yes, dontShowAgain, DialogResponses.skipForNow);
        if (result === DialogResponses.yes) {
            workspaceConfiguration.update(constants.configurationSettings.defaultWebAppToDeploy, this.fullId);
            workspaceConfiguration.update(constants.configurationSettings.deploySubpath, path.relative(workspacePath, deployPath)); // '' is a falsey value
            telemetryProperties.promptToSaveDeployConfigs = 'Yes';
        } else if (result === dontShowAgain) {
            workspaceConfiguration.update(constants.configurationSettings.defaultWebAppToDeploy, constants.none);
            telemetryProperties.promptToSaveDeployConfigs = "Don't show again";
        } else {
            telemetryProperties.promptToSaveDeployConfigs = 'Skip for now';
        }
    }

    private getIgnoredFoldersForDeployment(runtime: string): string[] {
        switch (runtime) {
            case runtimes.node:
                return ['node_modules{,/**}'];
            case runtimes.python:
                return ['env/{,/**}', 'venv{,/**}', 'lib{,/**}', 'lib64{,/**}'];
            default:
                return [];
        }
    }
}
