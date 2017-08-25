/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { AzureAccountWrapper } from './azureAccountWrapper';
import { WizardBase, WizardResult, WizardStep, UserCancelledError } from './wizard';
import { SubscriptionModels, ResourceManagementClient, ResourceModels } from 'azure-arm-resource';
import WebSiteManagementClient = require('azure-arm-website');
import * as WebSiteModels from '../node_modules/azure-arm-website/lib/models';
import * as util from './util';

export class WebAppCreator extends WizardBase {
    constructor(output: vscode.OutputChannel, readonly azureAccount: AzureAccountWrapper) {
        super(output);
        this.steps.push(new SubscriptionStep(this, azureAccount));
        this.steps.push(new ResourceGroupStep(this, azureAccount));
        this.steps.push(new AppServicePlanStep(this, azureAccount));
        this.steps.push(new WebsiteStep(this, azureAccount));
    }

    protected beforeExecute(step: WizardStep, stepIndex: number) {
        if (stepIndex == 0) {
            this.writeline('Start creating new Web App...');
        }
    }

    protected onExecuteError(step: WizardStep, stepIndex: number, error: Error) {
        this.writeline(`Failed to create new Web App - ${error.message}`);
    }

    protected onComplete() {
        this.writeline('Done!');
    }
}

class SubscriptionBasedWizardStep extends WizardStep {
    protected constructor(wizard: WizardBase, stepTitle: string, readonly azureAccount: AzureAccountWrapper) {
        super(wizard, stepTitle);
    }

    protected getSelectedSubscription(): SubscriptionModels.Subscription {
        const subscriptionStep = <SubscriptionStep>this.wizard.findStep(step => step instanceof SubscriptionStep, 'The Wizard must have a SubscriptionStep.');

        if (!subscriptionStep.subscription) {
            throw new Error('A subscription must be selected first.');
        }

        return subscriptionStep.subscription;
    }

    protected getSelectedResourceGroup(): ResourceModels.ResourceGroup {
        const resourceGroupStep = <ResourceGroupStep>this.wizard.findStep(step => step instanceof ResourceGroupStep, 'The Wizard must have a ResourceGroupStep.');

        if (!resourceGroupStep.resourceGroup) {
            throw new Error('A resource group must be selected first.');
        }

        return resourceGroupStep.resourceGroup;
    }
}

class SubscriptionStep extends WizardStep {
    private _subscription: SubscriptionModels.Subscription;

    constructor(wizard: WizardBase, readonly azureAccount: AzureAccountWrapper) {
        super(wizard, 'Select subscription');
    }

    async prompt(): Promise<void> {
        const inFilterSubscriptions = await this.azureAccount.getFilteredSubscriptions();
        const otherSubscriptions = await this.azureAccount.getAllSubscriptions();
        const quickPickItems: vscode.QuickPickItem[] = [];
        const quickPickOptions = { placeHolder: `Select the subscription where the new Web App will be created in. (${this.stepProgressText})` };

        inFilterSubscriptions.forEach(s => {
            const index = otherSubscriptions.findIndex(other => other.subscriptionId === s.subscriptionId);
            if (index >= 0) {   // Remove duplicated items from "all subscriptions".
                otherSubscriptions.splice(index, 1);
            }

            const item = {
                label: `📌 ${s.displayName}`,
                description: '',
                detail: s.subscriptionId
            };

            quickPickItems.push(item);
        });

        otherSubscriptions.forEach(s => {
            const item = {
                label: s.displayName,
                description: '',
                detail: s.subscriptionId
            };

            quickPickItems.push(item);
        });

        const result = await this.showQuickPick(quickPickItems, quickPickOptions);
        this._subscription = inFilterSubscriptions.concat(otherSubscriptions).find(s => s.subscriptionId === result.detail);
    }

    async execute(): Promise<void> {
        this.wizard.writeline(`The new Web App will be created in subscription "${this.subscription.displayName}" (${this.subscription.subscriptionId}).`);
    }

    get subscription(): SubscriptionModels.Subscription {
        return this._subscription;
    }
}

class ResourceGroupStep extends SubscriptionBasedWizardStep {
    private _createNew: boolean;
    private _rg: ResourceModels.ResourceGroup;

    constructor(wizard: WizardBase, azureAccount: AzureAccountWrapper) {
        super(wizard, 'Select or create resource group', azureAccount);
    }

    async prompt(): Promise<void> {
        const createNewItem: vscode.QuickPickItem = {
            label: '➕ New Resource Group',
            description: 'Creates a new resource group',
            detail: ''
        };
        const quickPickItems = [createNewItem];
        const quickPickOptions = { placeHolder: `Select the resource group where the new Web App will be created in. (${this.stepProgressText})` };
        const subscription = this.getSelectedSubscription();
        const resourceClient = new ResourceManagementClient(this.azureAccount.getCredentialByTenantId(subscription.tenantId), subscription.subscriptionId);
        const resourceGroups = await util.listAll(resourceClient.resourceGroups, resourceClient.resourceGroups.list());
        const locations = await this.azureAccount.getLocationsBySubscription(this.getSelectedSubscription());

        resourceGroups.forEach(rg => {
            quickPickItems.push({
                label: rg.name,
                description: `(${locations.find(l => l.name.toLowerCase() === rg.location.toLowerCase()).displayName})`,
                detail: ''
            });
        });

        const result = await this.showQuickPick(quickPickItems, quickPickOptions);

        if (result !== createNewItem) {
            const rg = resourceGroups.find(rg => rg.name.localeCompare(result.label) === 0);
            this._createNew = false;
            this._rg = rg;
            return;
        }

        const newRgName = await this.showInputBox({
            prompt: 'Enter the name of the new resource group.',
            validateInput: (value: string) => {
                value = value.trim();

                if (resourceGroups.findIndex(rg => rg.name.localeCompare(value) === 0) >= 0) {
                    return `Resource group name "${value}" already exists.`;
                }

                if (!value.match(/^[a-z0-9.\-_()]{0,89}[a-z0-9\-_()]$/ig)) {
                    return 'Resource group name should be 1-90 characters long and can only include alphanumeric characters, periods, ' +
                        'underscores, hyphens and parenthesis and cannot end in a period.';
                }

                return null;
            }
        });
        const locationPickItems = locations.map<vscode.QuickPickItem>(location => {
            return {
                label: location.displayName,
                description: `(${location.name})`,
                detail: ''
            };
        });
        const locationPickOptions = { placeHolder: 'Select the location of the new resource group.' };
        const pickedLocation = await this.showQuickPick(locationPickItems, locationPickOptions);

        this._createNew = true;
        this._rg = {
            name: newRgName,
            location: locations.find(l => l.displayName.localeCompare(pickedLocation.label) === 0).name
        }
    }

    async execute(): Promise<void> {
        if (!this._createNew) {
            this.wizard.writeline(`Existing resource group "${this._rg.name} (${this._rg.location})" will be used.`);
            return;
        }

        this.wizard.writeline(`Creating new resource group "${this._rg.name} (${this._rg.location})"...`);
        const subscription = this.getSelectedSubscription();
        const resourceClient = new ResourceManagementClient(this.azureAccount.getCredentialByTenantId(subscription.tenantId), subscription.subscriptionId);
        this._rg = await resourceClient.resourceGroups.createOrUpdate(this._rg.name, this._rg);
        this.wizard.writeline(`Resource group created.`);
    }

    get resourceGroup(): ResourceModels.ResourceGroup {
        return this._rg;
    }

    get createNew(): boolean {
        return this._createNew;
    }
}

class AppServicePlanStep extends SubscriptionBasedWizardStep {
    private _createNew: boolean;
    private _plan: WebSiteModels.AppServicePlan;

    constructor(wizard: WizardBase, azureAccount: AzureAccountWrapper) {
        super(wizard, 'Select or create App Service Plan', azureAccount);
    }

    async prompt(): Promise<void> {
        const createNewItem: vscode.QuickPickItem = {
            label: '➕ New App Service Plan',
            description: 'Creates a new App Service Plan',
            detail: ''
        };
        const quickPickItems = [createNewItem];
        const quickPickOptions = { placeHolder: `Select the App Service Plan for the new Web App. (${this.stepProgressText})` };
        const subscription = this.getSelectedSubscription();
        const client = new WebSiteManagementClient(this.azureAccount.getCredentialByTenantId(subscription.tenantId), subscription.subscriptionId);
        // You can create a web app and associate it with a plan from another resource group.
        // That's why we use list instead of listByResourceGroup below; and show resource group name in the quick pick list.
        const plans = await util.listAll(client.appServicePlans, client.appServicePlans.list());

        plans.forEach(plan => {
            // Currently we only support Linux web apps.
            if (plan.kind.toLowerCase() === 'linux') {
                quickPickItems.push({
                    label: plan.appServicePlanName,
                    description: `${plan.sku.name} (${plan.geoRegion})`,
                    detail: plan.resourceGroup
                });
            }
        });
        
        const pickedItem = await this.showQuickPick(quickPickItems, quickPickOptions);

        if (pickedItem !== createNewItem) {
            this._createNew = false;
            this._plan = plans.find(plan => plan.resourceGroup === pickedItem.detail && plan.appServicePlanName === pickedItem.label);
            return;
        }

        // Prompt for new plan information.
        const rg = this.getSelectedResourceGroup();
        const newPlanName = await this.showInputBox({
            prompt: 'Enter the name of the new App Service Plan.',
            validateInput: (value: string) => {
                value = value.trim();

                if (plans.findIndex(plan => plan.resourceGroup.toLowerCase() === rg.name && value.localeCompare(plan.name) === 0) >= 0) {
                    return `App Service Plan name "${value}" already exists in resource group "${rg.name}".`;
                }

                if (!value.match(/^[a-z0-9\-]{0,39}$/ig)) {
                    return 'App Service Plan name should be 1-40 characters long and can only include alphanumeric characters and hyphens.';
                }

                return null;
            }
        });

        // Prompt for Pricing tier
        const pricingTiers: vscode.QuickPickItem[] = [];
        const availableSkus = this.getPlanSkus();
        availableSkus.forEach(sku => {
            pricingTiers.push({
                label: sku.name,
                description: sku.tier,
                detail: ''
            });
        });
        const pickedSkuItem = await this.showQuickPick(pricingTiers, { placeHolder: 'Choose your pricing tier.' })
        const newPlanSku = availableSkus.find(s => s.name === pickedSkuItem.label);
        this._createNew = true;
        this._plan = {
            appServicePlanName: newPlanName,
            kind: 'linux',  // Currently we only support Linux web apps.
            sku: newPlanSku,
            location: rg.location
        };
    }

    async execute(): Promise<void> {
        if (!this._createNew) {
            this.wizard.writeline(`Existing App Service Plan "${this._plan.appServicePlanName} (${this._plan.sku.name})" will be used.`);
            return;
        }

        this.wizard.writeline(`Creating new App Service Plan "${this._plan.appServicePlanName} (${this._plan.sku.name})"...`);
        const subscription = this.getSelectedSubscription();
        const rg = this.getSelectedResourceGroup();
        const websiteClient = new WebSiteManagementClient(this.azureAccount.getCredentialByTenantId(subscription.tenantId), subscription.subscriptionId);
        this._plan = await websiteClient.appServicePlans.createOrUpdate(rg.name, this._plan.appServicePlanName, this._plan);
        this.wizard.writeline(`App Service Plan created.`);
    }

    get servicePlan(): WebSiteModels.AppServicePlan {
        return this._plan;
    }

    get createNew(): boolean {
        return this._createNew;
    }

    private getPlanSkus(): WebSiteModels.SkuDescription[] {
        return [
            {
                name: 'S1',
                tier: 'Standard',
                size: 'S1',
                family: 'S',
                capacity: 1
            },
            {
                name: 'S2',
                tier: 'Standard',
                size: 'S2',
                family: 'S',
                capacity: 1
            },
            {
                name: 'S3',
                tier: 'Standard',
                size: 'S3',
                family: 'S',
                capacity: 1
            },
            {
                name: 'B1',
                tier: 'Basic',
                size: 'B1',
                family: 'B',
                capacity: 1
            },
            {
                name: 'B2',
                tier: 'Basic',
                size: 'B2',
                family: 'B',
                capacity: 1
            },
            {
                name: 'B3',
                tier: 'Basic',
                size: 'B3',
                family: 'B',
                capacity: 1
            }
        ];
    }
}

class WebsiteStep extends SubscriptionBasedWizardStep {
    private _website: WebSiteModels.Site;

    constructor(wizard: WizardBase, azureAccount: AzureAccountWrapper) {
        super(wizard, 'Create Web App', azureAccount);
    }

    async prompt(): Promise<void> {
        const subscription = this.getSelectedSubscription();
        const client = new WebSiteManagementClient(this.azureAccount.getCredentialByTenantId(subscription.tenantId), subscription.subscriptionId);
        const siteName = await this.showInputBox({
            prompt: `Enter the name of the new Web App. (${this.stepProgressText})`,
            validateInput: (value: string) => {
                value = value.trim();

                if (!value.match(/^[a-z0-9\-]{0,59}$/ig)) {
                    return 'App name should be 1-60 characters long and can only include alphanumeric characters and hyphens.';
                }

                return null;
            }
        });
        const runtimeItems: vscode.QuickPickItem[] = [];
        const linuxRuntimeStacks = this.getLinuxRuntimeStack();
        
        linuxRuntimeStacks.forEach(rt => {
            runtimeItems.push({
                label: rt.displayName,
                description: '',
                detail: ''
            });
        });

        const pickedItem = await this.showQuickPick(runtimeItems, { placeHolder: 'Select runtime stack.' });
        const runtimeStack = linuxRuntimeStacks.find(rt => rt.displayName === pickedItem.label).name;
        const rg = this.getSelectedResourceGroup();
        const plan = this.getSelectedAppServicePlan();

        this._website = {
            name: siteName,
            location: rg.location,
            serverFarmId: plan.id,
            siteConfig: {
                linuxFxVersion: runtimeStack
            }
        }
    }

    async execute(): Promise<void> {
        this.wizard.writeline(`Creating new Web App "${this._website.name}"...`);
        const subscription = this.getSelectedSubscription();
        const rg = this.getSelectedResourceGroup();
        const websiteClient = new WebSiteManagementClient(this.azureAccount.getCredentialByTenantId(subscription.tenantId), subscription.subscriptionId);
        this._website = await websiteClient.webApps.createOrUpdate(rg.name, this._website.name, this._website);
        this.wizard.writeline(`Web App "${this._website.name}" created: https://${this._website.defaultHostName}`);
    }

    get website(): WebSiteModels.Site {
        return this._website;
    }

    private getSelectedAppServicePlan(): WebSiteModels.AppServicePlan {
        const appServicePlanStep = <AppServicePlanStep>this.wizard.findStep(step => step instanceof AppServicePlanStep, 'The Wizard must have a AppServicePlanStep.');
        
        if (!appServicePlanStep.servicePlan) {
            throw new Error('An App Service Plan must be selected first.');
        }

        return appServicePlanStep.servicePlan;
    }

    private getLinuxRuntimeStack(): LinuxRuntimeStack[] {
        return [
            {
                name: 'node|4.4',
                displayName: 'Node.js 4.4'
            },
            {
                name: 'node|4.5',
                displayName: 'Node.js 4.5'
            },
            {
                name: 'node|6.2',
                displayName: 'Node.js 6.2'
            },
            {
                name: 'node|6.6',
                displayName: 'Node.js 6.6'
            },
            {
                name: 'node|6.9',
                displayName: 'Node.js 6.9'
            },
            {
                name: 'node|6.10',
                displayName: 'Node.js 6.10'
            },
            {
                name: 'node|6.11',
                displayName: 'Node.js 6.11'
            },
            {
                name: 'node|8.0',
                displayName: 'Node.js 8.0'
            },
            {
                name: 'node|8.1',
                displayName: 'Node.js 8.1'
            }
        ];
    }
}

interface LinuxRuntimeStack {
    name: string;
    displayName: string;
}
