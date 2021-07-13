/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { WebSiteManagementModels } from '@azure/arm-appservice';
import * as vscode from 'vscode';
import { IAppSettingsClient, ISiteTreeRoot, validateAppSettingKey } from 'vscode-azureappservice';
import { AzExtTreeItem, AzureParentTreeItem, GenericTreeItem, IActionContext, ICreateChildImplContext, openInPortal, TreeItemIconPath, UserCancelledError } from 'vscode-azureextensionui';
import { AzureExtensionApiProvider } from 'vscode-azureextensionui/api';
import { localize } from '../localize';
import { nonNullProp } from '../utils/nonNull';
import { getThemedIconPath } from '../utils/pathUtils';
import { AzureDatabasesExtensionApi } from '../vscode-cosmos.api';
import { CosmosDBConnection } from './CosmosDBConnection';
import { SiteTreeItem } from './SiteTreeItem';

export class CosmosDBTreeItem extends AzureParentTreeItem<ISiteTreeRoot> {
    public static contextValueInstalled: string = 'сosmosDBConnections';
    public static contextValueNotInstalled: string = 'сosmosDBNotInstalled';
    public readonly label: string = 'Databases';
    public readonly childTypeLabel: string = 'Connection';
    public readonly parent!: SiteTreeItem;
    public readonly client: IAppSettingsClient;
    public cosmosDBExtension: vscode.Extension<AzureExtensionApiProvider | undefined> | undefined;
    public suppressMaskLabel = true;

    private readonly _endpointSuffix: string = '_ENDPOINT';
    private readonly _keySuffix: string = '_MASTER_KEY';
    private readonly _databaseSuffix: string = '_DATABASE_ID';

    private readonly _pgHostSuffix: string = '_DBHOST';
    private readonly _pgDbNameSuffix: string = '_DBNAME';
    private readonly _pgUserSuffix: string = '_DBUSER';
    private readonly _pgPassSuffix: string = '_DBPASS';
    private readonly _pgPortSuffix: string = '_DBPORT';

    private _cosmosDBApi: AzureDatabasesExtensionApi | undefined;

    constructor(parent: SiteTreeItem, client: IAppSettingsClient) {
        super(parent);
        this.client = client;
        this.cosmosDBExtension = vscode.extensions.getExtension('ms-azuretools.vscode-cosmosdb');
    }

    public get contextValue(): string {
        return this.cosmosDBExtension ? CosmosDBTreeItem.contextValueInstalled : CosmosDBTreeItem.contextValueNotInstalled;
    }

    public get iconPath(): TreeItemIconPath {
        return getThemedIconPath('AzureDatabases');
    }

    // eslint-disable-next-line @typescript-eslint/require-await
    public async refreshImpl(): Promise<void> {
        this.cosmosDBExtension = vscode.extensions.getExtension('ms-azuretools.vscode-cosmosdb');
    }

    public async loadMoreChildrenImpl(_clearCache: boolean): Promise<AzExtTreeItem[]> {
        if (!this.cosmosDBExtension) {
            return [new GenericTreeItem(this, {
                commandId: 'appService.InstallCosmosDBExtension',
                contextValue: 'InstallCosmosDBExtension',
                label: localize('installDb', 'Install Azure Databases Extension...')
            })];
        }

        const cosmosDBApi = await this.getCosmosDBApi();
        const appSettings = (await this.parent.client.listApplicationSettings()).properties || {};
        const connections: IDetectedConnection[] = this.detectMongoConnections(appSettings).concat(this.detectDocDBConnections(appSettings)).concat(this.detectPostgresConnections(appSettings));

        const treeItems = await this.createTreeItemsWithErrorHandling(
            connections,
            'invalidCosmosDBConnection',
            async (c: IDetectedConnection) => {
                const databaseTreeItem = await cosmosDBApi.findTreeItem({
                    connectionString: c.connectionString,
                    postgresData: c.postgresData
                });
                return databaseTreeItem ? new CosmosDBConnection(this, databaseTreeItem, c.keys) : undefined;
            },
            (c: IDetectedConnection) => c.keys[0] // just use first key for label if connection is invalid
        );

        if (treeItems.length > 0) {
            return treeItems;
        } else {
            return [new GenericTreeItem(this, {
                commandId: 'appService.AddAzureDatabasesConnection',
                contextValue: 'AddAzureDatabasesConnection',
                label: localize('addDbConnection', 'Add Azure Databases Connection...')
            })];
        }
    }

    public async createChildImpl(context: ICreateChildImplContext): Promise<AzExtTreeItem> {
        const cosmosDBApi = await this.getCosmosDBApi();
        const databaseToAdd = await cosmosDBApi.pickTreeItem({
            resourceType: 'Database'
        });
        if (!databaseToAdd) {
            throw new UserCancelledError('cosmosDBpickTreeItem');
        }

        const appSettingsDict = await this.parent.client.listApplicationSettings();
        appSettingsDict.properties = appSettingsDict.properties || {};

        let newAppSettings: Map<string, string>;
        if (databaseToAdd.docDBData) {
            const docdbAppSettings = new Map([
                [this._endpointSuffix, nonNullProp(databaseToAdd, 'docDBData').documentEndpoint],
                [this._keySuffix, nonNullProp(databaseToAdd, 'docDBData').masterKey],
                [this._databaseSuffix, databaseToAdd.databaseName]
            ]);
            const docdbSuffixes = [this._endpointSuffix, this._keySuffix, this._databaseSuffix];
            newAppSettings = await this.promptForAppSettings(context, appSettingsDict, docdbAppSettings, docdbSuffixes, 'AZURE_COSMOS');
        } else if (databaseToAdd.postgresData) {
            const postgresAppSettings: Map<string | undefined, string | undefined> = new Map([
                [this._pgHostSuffix, databaseToAdd.hostName],
                [this._pgDbNameSuffix, databaseToAdd.databaseName],
                [this._pgUserSuffix, databaseToAdd.postgresData?.username],
                [this._pgPassSuffix, databaseToAdd.postgresData?.password],
                [this._pgPortSuffix, databaseToAdd.port]
            ]);
            const postgresSuffixes = [this._pgHostSuffix, this._pgDbNameSuffix, this._pgUserSuffix, this._pgPassSuffix, this._pgPortSuffix];
            newAppSettings = await this.promptForAppSettings(context, appSettingsDict, postgresAppSettings, postgresSuffixes, 'POSTGRES');
        } else {
            const mongoAppSettings: Map<string | undefined, string | undefined> = new Map([[undefined, databaseToAdd.connectionString]]);
            newAppSettings = await this.promptForAppSettings(context, appSettingsDict, mongoAppSettings, undefined, 'MONGO_URL');
        }

        for (const [k, v] of newAppSettings) {
            appSettingsDict.properties[k] = v;
        }

        await this.parent.client.updateApplicationSettings(appSettingsDict);
        await this.parent.appSettingsNode.refresh(context);

        const createdDatabase = new CosmosDBConnection(this, databaseToAdd, Array.from(newAppSettings.keys()));
        context.showCreatingTreeItem(createdDatabase.label);

        const revealDatabase: vscode.MessageItem = { title: localize('reveal', 'Reveal Database') };
        const manageFirewallRules: vscode.MessageItem = { title: localize('manageFirewallRulesMsgItem', 'Manage Firewall Rules') };
        const message: string = localize(
            'connectedDatabase', 'Database "{0}" connected to web app "{1}". Created the following application settings: {2}',
            createdDatabase.label, this.parent.client.fullName, Array.from(newAppSettings.keys()).join(', '));
        // Don't wait
        const buttons: vscode.MessageItem[] = [revealDatabase];
        if (createdDatabase.cosmosExtensionItem.azureData && createdDatabase.cosmosExtensionItem.postgresData) {
            buttons.push(manageFirewallRules);
        }
        void vscode.window.showInformationMessage(message, ...buttons).then(async (result: vscode.MessageItem | undefined) => {
            if (result === revealDatabase) {
                await createdDatabase.cosmosExtensionItem.reveal();
            } else if (result === manageFirewallRules) {
                const accountId: string | undefined = createdDatabase.cosmosExtensionItem.azureData?.accountId;
                await openInPortal(this.root, `${accountId}/connectionSecurity`);
            }
        });
        return createdDatabase;
    }

    public hasMoreChildrenImpl(): boolean {
        return false;
    }

    private async getCosmosDBApi(): Promise<AzureDatabasesExtensionApi> {
        if (this._cosmosDBApi) {
            return this._cosmosDBApi;
        } else if (this.cosmosDBExtension) {
            if (!this.cosmosDBExtension.isActive) {
                await this.cosmosDBExtension.activate();
            }

            // The Cosmos DB extension just recently added support for 'AzureExtensionApiProvider' so we should do an additional check just to makes sure it's defined
            if (this.cosmosDBExtension.exports) {
                this._cosmosDBApi = this.cosmosDBExtension.exports.getApi<AzureDatabasesExtensionApi>('^1.0.0');
                return this._cosmosDBApi;
            }
        }

        throw new Error(localize('azureDbError', 'You must have the "Azure Databases" extension installed to perform this operation.'));
    }

    private detectMongoConnections(appSettings: { [propertyName: string]: string }): IDetectedConnection[] {
        const result: IDetectedConnection[] = [];
        for (const key of Object.keys(appSettings)) {
            const value = appSettings[key];
            if (/^mongodb[^:]*:\/\//i.test(value)) {
                result.push({
                    keys: [key],
                    connectionString: appSettings[key]
                });
            }
        }
        return result;
    }

    private detectPostgresConnections(appSettings: { [propertyName: string]: string }): IDetectedConnection[] {
        const portDefault = '5432';
        const result: IDetectedConnection[] = [];
        const regexp = new RegExp(`(.+)${this._pgHostSuffix}`, 'i');

        for (const key of Object.keys(appSettings)) {
            const match = key && key.match(regexp);
            if (match) {
                const prefix = match[1];
                const hostKey = prefix + this._pgHostSuffix;
                const dbNameKey = prefix + this._pgDbNameSuffix;
                const userKey = prefix + this._pgUserSuffix;
                const passKey = prefix + this._pgPassSuffix;
                const portKey = prefix + this._pgPortSuffix;

                if (appSettings[hostKey]) {
                    const keys: string[] = [hostKey, portKey];
                    for (const optionalKey of [userKey, passKey, dbNameKey]) {
                        if (appSettings[optionalKey]) {
                            keys.push(optionalKey);
                        }
                    }
                    result.push({
                        keys, postgresData:
                        {
                            hostName: appSettings[hostKey],
                            port: appSettings[portKey] ? appSettings[portKey] : portDefault,
                            username: appSettings[userKey],
                            password: appSettings[passKey],
                            databaseName: appSettings[dbNameKey]
                        }
                    });
                }
            }
        }
        return result;
    }

    private detectDocDBConnections(appSettings: { [propertyName: string]: string }): IDetectedConnection[] {
        const connectionStringEndpointPrefix = 'AccountEndpoint=';
        const connectionStringKeyPrefix = 'AccountKey=';

        const result: IDetectedConnection[] = [];
        const regexp = new RegExp(`(.+)${this._endpointSuffix}`, 'i');
        for (const key of Object.keys(appSettings)) {
            // First, check for connection string split up into multiple app settings (endpoint, key, and optional database id)
            const match = key && key.match(regexp);
            if (match) {
                const prefix = match[1];
                const endpointKey = prefix + this._endpointSuffix;
                const keyKey = prefix + this._keySuffix;
                const documentEndpoint: string | undefined = appSettings[endpointKey];
                const masterKey: string | undefined = appSettings[keyKey];

                if (documentEndpoint && masterKey) {
                    const keys: string[] = [endpointKey, keyKey];
                    let connectionString = `${connectionStringEndpointPrefix}${documentEndpoint};${connectionStringKeyPrefix}${masterKey};`;

                    const databaseKey = prefix + this._databaseSuffix;
                    if (Object.keys(appSettings).find((k) => k === databaseKey)) {
                        keys.push(databaseKey);
                        connectionString += `Database=${appSettings[databaseKey]}`;
                    }

                    result.push({ keys, connectionString });
                }
            } else {
                // Second, check for connection string as one app setting
                const regExp1 = new RegExp(connectionStringEndpointPrefix, 'i');
                const regExp2 = new RegExp(connectionStringKeyPrefix, 'i');

                const value: string = appSettings[key];
                if (regExp1.test(value) && regExp2.test(value)) {
                    result.push({ keys: [key], connectionString: value });
                }
            }
        }

        return result;
    }

    private async promptForAppSettings(context: IActionContext, appSettingsDict: WebSiteManagementModels.StringDictionary, accountAppSettings: Map<string | undefined, string | undefined>, suffixes: string[] | undefined, defaultPrefixString: string): Promise<Map<string, string>> {
        const prompt: string = suffixes ? localize('enterPrefix', 'Enter new connection setting prefix') : localize('enterKey', 'Enter new connection setting key');
        const errorMsg: string = suffixes ? localize('prefixError', 'Connection setting prefix cannot be empty.') : localize('keyError', 'Connection setting key cannot be empty.');
        const appSettingsPrefix: string = await context.ui.showInputBox({
            prompt,
            stepName: 'connectionSettingPrefix',
            validateInput: (v: string): string | undefined => {
                if (!v) {
                    return errorMsg;
                } else {
                    return this.validateAppSettingPrefix(v, appSettingsDict, suffixes);
                }
            },
            value: defaultPrefixString
        });

        return this.getAppSettings(accountAppSettings, appSettingsPrefix);

    }

    private getAppSettings(appSettings: Map<string | undefined, string | undefined>, appSettingsPrefix: string): Map<string, string> {
        const result: Map<string, string> = new Map<string, string>();
        for (const [key, value] of appSettings) {
            if (key && value) {
                result.set(appSettingsPrefix + key, value);
            } else if (value) {
                result.set(appSettingsPrefix, value);
            }
        }
        return result;
    }

    private validateAppSettingPrefix(prefix: string, appSettingsDict: WebSiteManagementModels.StringDictionary, suffixes: string[] | undefined): string | undefined {
        if (suffixes) {
            return suffixes.reduce<string | undefined>((result, suffix) => result || validateAppSettingKey(appSettingsDict, this.parent.client, prefix + suffix), undefined);
        }
        return validateAppSettingKey(appSettingsDict, this.parent.client, prefix);
    }
}

interface IDetectedConnection {
    keys: string[];
    connectionString?: string;
    postgresData?: {
        hostName: string;
        port: string;
        databaseName: string | undefined;
        username: string | undefined;
        password: string | undefined;
    };
}
