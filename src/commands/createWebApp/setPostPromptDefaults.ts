/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { WebSiteManagementClient, WebSiteManagementModels } from '@azure/arm-appservice';
import { MessageItem } from "vscode";
import { SiteNameStep, tryGetAppServicePlan, WebsiteOS } from "vscode-azureappservice";
import { AzExtLocation, DialogResponses, IActionContext, LocationListStep, parseError } from "vscode-azureextensionui";
import { localize } from "../../localize";
import { createWebSiteClient } from "../../utils/azureClients";
import { getResourceGroupFromId } from '../../utils/azureUtils';
import { nonNullProp } from "../../utils/nonNull";
import { getWorkspaceSetting, updateGlobalSetting } from "../../vsCodeConfig/settings";
import { IWebAppWizardContext } from './IWebAppWizardContext';
import { AzConfig, AzConfigProperty, readAzConfig } from "./readAzConfig";

const maxNumberOfSites: number = 3;
const freeTier = 'free';

export async function setPostPromptDefaults(wizardContext: IWebAppWizardContext, siteNameStep: SiteNameStep): Promise<void> {
    // Reading az config should always happen after prompting because it can cause a few seconds delay
    const config: AzConfig = await readAzConfig(wizardContext, AzConfigProperty.group, AzConfigProperty.location);

    if (config.location) {
        await LocationListStep.setLocation(wizardContext, config.location);
    }
    const location: AzExtLocation = await LocationListStep.getLocation(wizardContext);

    let defaultName: string = `appsvc_${wizardContext.newSiteOS}_${location.name}`;
    const newSkuTier = nonNullProp(nonNullProp(wizardContext, 'newPlanSku'), 'tier').toLowerCase();
    if (newSkuTier !== freeTier) {
        // Use "premium" instead of "premium v2"
        const simpleTierName = newSkuTier.split(/v[0-9]/)[0].trim();
        defaultName += `_${simpleTierName}`;
    }
    const defaultGroupName: string = config.group || defaultName;
    const defaultPlanName: string = defaultName;

    try {
        const client: WebSiteManagementClient = await createWebSiteClient(wizardContext);
        const asp: WebSiteManagementModels.AppServicePlan | undefined = await tryGetAppServicePlan(client, defaultGroupName, defaultPlanName);
        const hasPerfDrop = checkPlanForPerformanceDrop(asp);
        if (asp && (hasPerfDrop || !matchesTier(asp, newSkuTier))) {
            // Subscriptions can only have 1 free tier Linux plan so show a warning if there are too many apps on the plan
            if (wizardContext.newSiteOS === WebsiteOS.linux && newSkuTier === freeTier && hasPerfDrop) {
                await promptPerformanceWarning(wizardContext, asp);
                wizardContext.newResourceGroupName = defaultGroupName;
                wizardContext.newPlanName = defaultPlanName;
            } else {
                // Check if there are plans prefixed with default name that match the tier and don't have a performance drop. If so, use that plan. Otherwise, create a new rg and asp using `getRelatedName`

                const allAppServicePlans: WebSiteManagementModels.AppServicePlan[] = await client.appServicePlans.list();
                const defaultPlans: WebSiteManagementModels.AppServicePlan[] = allAppServicePlans.filter(plan => {
                    return plan.name && plan.name.includes(defaultPlanName) && getResourceGroupFromId(nonNullProp(plan, 'id')).includes(defaultGroupName);
                });

                // when using appServicePlans.list, the numOfSites are all set to 0 so individually get each plan and look for one with less than 3 sites
                for (const plan of defaultPlans) {
                    if (plan.name) {
                        const groupName: string = getResourceGroupFromId(nonNullProp(plan, 'id'));
                        const fullPlanData: WebSiteManagementModels.AppServicePlan | undefined = await tryGetAppServicePlan(client, groupName, plan.name);
                        if (fullPlanData && matchesTier(fullPlanData, newSkuTier) && !checkPlanForPerformanceDrop(fullPlanData)) {
                            wizardContext.newResourceGroupName = groupName;
                            wizardContext.newPlanName = plan.name;
                            break;
                        }
                    }
                }

                wizardContext.newResourceGroupName = wizardContext.newResourceGroupName || await siteNameStep.getRelatedName(wizardContext, defaultGroupName);
                if (!wizardContext.newResourceGroupName) {
                    throw new Error(localize('noUniqueNameRg', 'Failed to generate unique name for resources. Use advanced creation to manually enter resource names.'));
                }

                wizardContext.newPlanName = await siteNameStep.getRelatedName(wizardContext, defaultPlanName);
                if (!wizardContext.newPlanName) {
                    throw new Error(localize('noUniqnueNameAsp', 'Failed to generate unique name for app service plan. Use advanced creation to manually enter plan names.'));
                }
            }
        } else {
            wizardContext.newResourceGroupName = defaultGroupName;
            wizardContext.newPlanName = defaultPlanName;
        }
    } catch (error) {
        if (parseError(error).errorType === 'AuthorizationFailed') {
            // User has restricted permissions for something. We'll use the default values for now and let the  `ResourceGroupCreateStep` & `AppServicePlanCreateStep` handle the 'AuthorizationFailed' error down the line
            wizardContext.newResourceGroupName = defaultGroupName;
            wizardContext.newPlanName = defaultPlanName;
        } else {
            throw error;

        }
    }
}

function matchesTier(asp: WebSiteManagementModels.AppServicePlan | undefined, tier: string): boolean {
    return normalizeTier(asp?.sku?.tier) === normalizeTier(tier);
}

function normalizeTier(tier: string | undefined): string | undefined {
    return tier?.toLowerCase().replace(/\s/g, '');
}

function checkPlanForPerformanceDrop(asp: WebSiteManagementModels.AppServicePlan | undefined): boolean {
    // for free and basic plans, there is a perf drop after 3 active apps are running
    if (asp && asp.numberOfSites !== undefined && asp.numberOfSites >= maxNumberOfSites) {
        const tier: string | undefined = asp.sku && asp.sku.tier;
        if (tier && /^(basic|free)$/i.test(tier)) {
            return true;
        }
    }

    return false;
}

async function promptPerformanceWarning(context: IActionContext, asp: WebSiteManagementModels.AppServicePlan): Promise<void> {
    context.telemetry.properties.performanceWarning = 'true';
    const showPlanPerformanceWarningSetting: string = 'showPlanPerformanceWarning';
    const showPerfWarning: boolean | undefined = getWorkspaceSetting(showPlanPerformanceWarningSetting);

    if (showPerfWarning) {
        context.telemetry.properties.turnOffPerfWarning = 'false';

        const numberOfSites: number = nonNullProp(asp, 'numberOfSites');
        const createAnyway: MessageItem = { title: localize('createAnyway,', 'Create anyway') };
        const message: string = localize('tooManyPlansWarning', 'The selected plan currently has {0} apps. Deploying more than {1} apps may degrade the performance on the apps in the plan.  Use "Create Web App... (Advanced)" to change the default resource names.', numberOfSites, maxNumberOfSites);
        const input: MessageItem = await context.ui.showWarningMessage(message, { modal: true, stepName: 'showPerfWarning' }, createAnyway, DialogResponses.dontWarnAgain);

        if (input === DialogResponses.dontWarnAgain) {
            context.telemetry.properties.turnOffPerfWarning = 'true';
            await updateGlobalSetting(showPlanPerformanceWarningSetting, false);
        }
    }
}
