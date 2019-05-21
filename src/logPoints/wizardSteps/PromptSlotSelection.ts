/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Site } from 'azure-arm-website/lib/models';
import * as vscode from 'vscode';
import { UserCancelledError, AzureTreeItem, IAzureQuickPickItem } from 'vscode-azureextensionui';
import { DeploymentSlotsTreeItem } from '../../explorer/DeploymentSlotsTreeItem';
import { SiteTreeItem } from '../../explorer/SiteTreeItem';
import { WizardStep } from '../../wizard';
import { LogPointsSessionWizard } from '../LogPointsSessionWizard';

export class PromptSlotSelection extends WizardStep {
    constructor(private _wizard: LogPointsSessionWizard, readonly site: Site) {
        super(_wizard, 'Choose a deployment slot.');
    }

    public async prompt(): Promise<void> {
        // Decide if this AppService uses deployment slots
        let deploymentSlotsTreeItems: SiteTreeItem[] = await vscode.window.withProgress({ location: vscode.ProgressLocation.Window }, async p => {
            const message = 'Enumerating deployment slots for the App Service...';
            p.report({ message: message });
            this._wizard.writeline(message);
            return await this.getDeploymentSlotsTreeItems();
        });

        this._wizard.writeline(`Got ${deploymentSlotsTreeItems.length} deployment slot(s)`);

        // if there is only one slot, just use that one and don't prompt for user selection.
        if (deploymentSlotsTreeItems.length === 1) {
            this._wizard.selectedDeploymentSlotTreeItem = deploymentSlotsTreeItems[0];
            this._wizard.writeline(`Automatically selected deployment slot ${this._wizard.selectedDeploymentSlot!.fullName}.`); // non-null behavior unknown. Should be handled by logPoints team
            return;
        }

        const deploymentQuickPickItems = deploymentSlotsTreeItems.map((deploymentSlotTreeItem: SiteTreeItem) => {
            return <IAzureQuickPickItem<SiteTreeItem>>{
                label: deploymentSlotTreeItem.label,
                description: '',
                data: deploymentSlotTreeItem
            };
        });

        const quickPickOption = { placeHolder: `Please select a deployment slot: (${this.stepProgressText})` };
        let pickedItem;
        try {
            pickedItem = await this.showQuickPick(deploymentQuickPickItems, quickPickOption);
        } catch (e) {
            if (e instanceof UserCancelledError) {
                vscode.window.showInformationMessage('Please select a deployment slot.');
            }
            throw e;
        }
        this._wizard.selectedDeploymentSlotTreeItem = pickedItem.data;
        this._wizard.writeline(`The deployment slot you selected is: ${this._wizard.selectedDeploymentSlot!.fullName}`); // non-null behavior unknown. Should be handled by logPoints team
    }

    /**
     * Returns all the deployment slots and the production slot.
     */
    private async getDeploymentSlotsTreeItems(): Promise<SiteTreeItem[]> {
        const result = await this._wizard.uiTreeItem.getCachedChildren(this._wizard.context);

        let deploymentSlotsCategoryNode: DeploymentSlotsTreeItem | undefined;
        if (!result || result.length <= 0) {
            throw new Error('Cannot find any tree node under the App Service node.');
        }

        result.forEach((treeNode: AzureTreeItem) => {
            if (treeNode instanceof DeploymentSlotsTreeItem) {
                deploymentSlotsCategoryNode = treeNode;
            }
        });

        if (!deploymentSlotsCategoryNode) {
            throw new Error('Cannot find the Deployment Slots tree node');
        }

        const deploymentSlotTreeNodes = <SiteTreeItem[]>await deploymentSlotsCategoryNode.getCachedChildren(this._wizard.context);

        return [this._wizard.uiTreeItem].concat(deploymentSlotTreeNodes);
    }
}
