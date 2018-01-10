/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SubscriptionModels } from 'azure-arm-resource';

// tslint:disable-next-line:no-require-imports
import WebSiteManagementClient = require('azure-arm-website');
import * as vscode from 'vscode';
import { IAzureNode, UserCancelledError } from 'vscode-azureextensionui';
import { DeploymentSlotTreeItem } from './explorer/DeploymentSlotTreeItem';
import { IQuickPickItemWithData } from './util';
import { nodeUtils } from './utils/nodeUtils';
import { WizardBase, WizardStep } from './wizard';

export class DeploymentSlotSwapper extends WizardBase {
    private readonly slot: IAzureNode<DeploymentSlotTreeItem>;

    constructor(output: vscode.OutputChannel, slot: IAzureNode<DeploymentSlotTreeItem>) {
        super(output);
        this.slot = slot;
    }

    protected initSteps(): void {
        this.steps.push(new SwapStep(this, this.slot));
    }

    protected beforeExecute(): void {
        this.writeline('Initializing deployment swap...');
    }
}

class SwapStep extends WizardStep {
    private _subscription: SubscriptionModels.Subscription;
    private _sourceSlotNode: IAzureNode<DeploymentSlotTreeItem>;
    private targetSlotNode: IAzureNode<DeploymentSlotTreeItem | undefined>;

    private readonly _productionSlotLabel: string = 'production';

    get sourceSlot(): DeploymentSlotTreeItem {
        return this._sourceSlotNode.treeItem;
    }

    constructor(wizard: WizardBase, slot: IAzureNode<DeploymentSlotTreeItem>) {
        super(wizard, 'Select a slot to swap with');
        this._sourceSlotNode = slot;
    }

    public async prompt(): Promise<void> {
        const deploymentSlots: IAzureNode<DeploymentSlotTreeItem>[] = <IAzureNode<DeploymentSlotTreeItem>[]>await this._sourceSlotNode.parent.getCachedChildren();
        const otherSlots: IQuickPickItemWithData<IAzureNode<DeploymentSlotTreeItem | undefined>>[] = [{
            label: this._productionSlotLabel,
            description: 'Swap slot with production',
            detail: '',
            data: undefined
        }];

        for (const slot of deploymentSlots) {
            if (this.sourceSlot.siteWrapper.slotName !== slot.treeItem.siteWrapper.slotName) {
                // Deployment slots must have an unique name
                const otherSlot: IQuickPickItemWithData<IAzureNode<DeploymentSlotTreeItem | undefined>> = {
                    label: slot.treeItem.siteWrapper.slotName,
                    description: '',
                    data: slot
                };

                otherSlots.push(otherSlot);
            }
        }

        const quickPickOptions = { placeHolder: `"${this.sourceSlot.siteWrapper.slotName}" will be swapped with the destination slot.`, ignoreFocusOut: true };
        const result = await this.showQuickPick(otherSlots, quickPickOptions);

        if (result) {
            this.targetSlotNode = result.data;
        } else {
            throw new UserCancelledError();
        }
    }

    public async execute(): Promise<void> {
        const client: WebSiteManagementClient = nodeUtils.getWebSiteClient(this._sourceSlotNode);
        // if this.targetSlot was assigned undefined, the user selected 'production'
        !this.targetSlotNode ?
            await client.webApps.swapSlotWithProduction(this.sourceSlot.site.resourceGroup, this.sourceSlot.site.repositorySiteName, { targetSlot: this.sourceSlot.siteWrapper.slotName, preserveVnet: true }) :
            await client.webApps.swapSlotSlot(this.sourceSlot.site.resourceGroup, this.sourceSlot.site.repositorySiteName, { targetSlot: this.targetSlotNode.treeItem.siteWrapper.slotName, preserveVnet: true }, this.sourceSlot.siteWrapper.slotName);

        const targetSlotLabel: string = this.targetSlotNode ? this.targetSlotNode.treeItem.siteWrapper.slotName : this._productionSlotLabel;
        this.wizard.writeline(`"${targetSlotLabel}" was swapped with "${this.sourceSlot.siteWrapper.slotName}".`);
    }

    get subscription(): SubscriptionModels.Subscription {
        return this._subscription;
    }
}
