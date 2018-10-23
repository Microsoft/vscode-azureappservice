/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as vscode from 'vscode';
import { ISiteTreeRoot } from 'vscode-azureappservice';
import { AzureParentTreeItem, AzureTreeItem, GenericTreeItem, UserCancelledError } from 'vscode-azureextensionui';
import { IConnections } from '../../src/commands/connections/IConnections';
import * as constants from '../constants';
import { ConnectionsTreeItem } from './ConnectionsTreeItem';
import { CosmosDBDatabase } from './CosmosDBDatabase';

export class CosmosDBTreeItem extends AzureParentTreeItem<ISiteTreeRoot> {
    public static contextValue: string = 'сosmosDBConnections';
    public readonly contextValue: string = CosmosDBTreeItem.contextValue;
    public readonly label: string = 'Cosmos DB';
    public readonly parent: ConnectionsTreeItem;

    constructor(parent: ConnectionsTreeItem) {
        super(parent);
    }

    public get iconPath(): string | vscode.Uri | { light: string | vscode.Uri; dark: string | vscode.Uri } {
        return {
            light: path.join(__filename, '..', '..', '..', '..', 'resources', 'light', 'CosmosDBAccount.svg'),
            dark: path.join(__filename, '..', '..', '..', '..', 'resources', 'dark', 'CosmosDBAccount.svg')
        };
    }

    public async loadMoreChildrenImpl(_clearCache: boolean): Promise<AzureTreeItem<ISiteTreeRoot>[]> {
        const cosmosDB = vscode.extensions.getExtension('ms-azuretools.vscode-cosmosdb');
        if (!cosmosDB) {
            return [new GenericTreeItem(this, {
                commandId: 'appService.InstallCosmosDBExtension',
                contextValue: 'InstallCosmosDBExtension',
                label: 'Install Cosmos DB Extension...'
            })];
        }
        const workspaceConfig = vscode.workspace.getConfiguration(constants.extensionPrefix);
        const connections = workspaceConfig.get<IConnections[]>(constants.configurationSettings.connections, []);
        // tslint:disable-next-line:strict-boolean-expressions
        const unit = connections.find((x: IConnections) => x.webAppId === this.root.client.id) || <IConnections>{};
        if (!unit.cosmosDB || unit.cosmosDB.length === 0) {
            return [new GenericTreeItem(this, {
                commandId: 'appService.AddCosmosDBConnection',
                contextValue: 'AddCosmosDBConnection',
                label: 'Add Cosmos DB Connection...'
            })];
        }
        return unit.cosmosDB.map(connectionId => {
            return new CosmosDBDatabase(this, connectionId);
        });
    }

    public async createChildImpl(showCreatingTreeItem: (label: string) => void): Promise<AzureTreeItem<ISiteTreeRoot>> {
        const connectionToAdd = <string>await vscode.commands.executeCommand('cosmosDB.api.getDatabase');
        if (!connectionToAdd) {
            throw new UserCancelledError();
        }

        const workspaceConfig = vscode.workspace.getConfiguration(constants.extensionPrefix);
        const allConnections = workspaceConfig.get<IConnections[]>(constants.configurationSettings.connections, []);
        let connectionsUnit = allConnections.find((x: IConnections) => x.webAppId === this.root.client.id);
        if (!connectionsUnit) {
            connectionsUnit = <IConnections>{};
            allConnections.push(connectionsUnit);
            connectionsUnit.webAppId = this.root.client.id;
        }

        // tslint:disable-next-line:strict-boolean-expressions
        connectionsUnit.cosmosDB = connectionsUnit.cosmosDB || [];
        if (!connectionsUnit.cosmosDB.find((x: string) => x === connectionToAdd)) {
            const connectionStringValue = (<string>await vscode.commands.executeCommand('cosmosDB.api.getConnectionString', connectionToAdd));

            let allSettingsNames: string;
            const appSettingsToCreate = new Map<string, string>();
            if (/^mongo/i.test(connectionStringValue)) {
                appSettingsToCreate.set('MONGO_URL', connectionStringValue);

                allSettingsNames = '"MONGO_URL"';
            } else {
                const parsedConnection = connectionStringValue.match(/^AccountEndpoint=(.*);AccountKey=(.*);Database=(.*)$/);
                if (parsedConnection === null) {
                    throw new Error(`Can't parse provided connection string: ${connectionStringValue}. Should match the next pattern: AccountEndpoint=...;AccountKey=...;Database=...`);
                }
                appSettingsToCreate.set('COSMOS_ENDPOINT', parsedConnection[1]);
                appSettingsToCreate.set('COSMOS_MASTER_KEY', parsedConnection[2]);
                appSettingsToCreate.set('COSMOS_DATABASE_ID', parsedConnection[3]);

                allSettingsNames = '"COSMOS_ENDPOINT", "COSMOS_MASTER_KEY", "COSMOS_DATABASE_ID"';
            }

            const appSettingsNode = this.parent.parent.appSettingsNode;
            appSettingsToCreate.forEach(async (value, appSetting) => appSettingsNode.editSettingItem(appSetting, appSetting, value));
            await appSettingsNode.refresh();

            connectionsUnit.cosmosDB.push(connectionToAdd);
            workspaceConfig.update(constants.configurationSettings.connections, allConnections);
            const createdDatabase = new CosmosDBDatabase(this, connectionToAdd);
            showCreatingTreeItem(createdDatabase.label);

            const ok: vscode.MessageItem = { title: 'OK' };
            const showDatabase: vscode.MessageItem = { title: 'Show Database' };
            // Don't wait
            vscode.window.showInformationMessage(`Database "${createdDatabase.label}" connected to Web App "${this.root.client.fullName}". Created ${allSettingsNames} App Settings.`, ok, showDatabase).then(async (result: vscode.MessageItem | undefined) => {
                if (result === showDatabase) {
                    vscode.commands.executeCommand('appService.RevealConnection', createdDatabase);
                }
            });

            return createdDatabase;
        }
        throw new Error(`Connection with id "${connectionToAdd}" is already attached.`);
    }

    public hasMoreChildrenImpl(): boolean {
        return false;
    }
}
