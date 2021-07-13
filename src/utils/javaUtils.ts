/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { WebSiteManagementModels } from "@azure/arm-appservice";
import * as fse from 'fs-extra';
import * as path from 'path';
import { workspace } from "vscode";
import { IActionContext, UserCancelledError } from 'vscode-azureextensionui';
import { localize } from "../localize";
import { SiteTreeItem } from "../tree/SiteTreeItem";

export namespace javaUtils {
    const DEFAULT_PORT: string = '8080';
    const PORT_KEY: string = 'PORT';

    function isJavaWebContainerRuntime(runtime: string | undefined): boolean {
        return !!runtime && /^(tomcat|wildfly)/i.test(runtime);
    }

    function isJavaSERuntime(runtime: string | undefined): boolean {
        return !!runtime && /^java/i.test(runtime);
    }

    export function isJavaRuntime(runtime: string | undefined): boolean {
        return isJavaWebContainerRuntime(runtime) || isJavaSERuntime(runtime);
    }

    function isJavaArtifact(artifactPath: string): boolean {
        return /^(.jar|.war)/i.test(path.extname(artifactPath));
    }

    function getArtifactTypeByJavaRuntime(runtime: string | undefined): string {
        if (isJavaSERuntime(runtime)) {
            return 'jar';
        } else if (isJavaWebContainerRuntime(runtime)) {
            return 'war';
        } else {
            throw new Error(localize('invalidJava', 'Invalid java runtime: {0}', runtime));
        }
    }

    function getJavaArtifactExtensions(): string[] {
        return ['jar', 'war'];
    }

    function isJavaSERequiredPortConfigured(appSettings: WebSiteManagementModels.StringDictionary | undefined): boolean {
        if (appSettings && appSettings.properties) {
            for (const key of Object.keys(appSettings.properties)) {
                if (key.toUpperCase() === PORT_KEY) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * Return if all of the workspace folders contain Java projects in their base paths.
     * Or if optional fsPath passed in is a Java artifact or project
     * Only Maven and Gradle are taken into consideration for now.
     */
    export async function isJavaProject(deployFsPath?: string): Promise<boolean> {

        // if there is a deployed project path, use that for the default
        if (deployFsPath) {
            return await isJavaFolder(deployFsPath) || isJavaArtifact(deployFsPath);
        }

        // if there's no workspace, it can return an empty array
        if (!workspace.workspaceFolders || workspace.workspaceFolders.length === 0) {
            return false;
        }

        for (const workspaceFolder of workspace.workspaceFolders) {
            if (await isJavaFolder(workspaceFolder.uri.fsPath)) {
                continue;
            }
            return false;
        }

        return true;
    }

    async function isJavaFolder(fsPath: string): Promise<boolean> {
        return await fse.pathExists(path.join(fsPath, 'pom.xml')) || await fse.pathExists(path.join(fsPath, 'build.gradle'));
    }

    export async function configureJavaSEAppSettings(context: IActionContext, node: SiteTreeItem): Promise<WebSiteManagementModels.StringDictionary | undefined> {
        const appSettings: WebSiteManagementModels.StringDictionary = await node.root.client.listApplicationSettings();
        if (isJavaSERequiredPortConfigured(appSettings)) {
            return undefined;
        }

        appSettings.properties = appSettings.properties || {};
        const port: string = await context.ui.showInputBox({
            value: DEFAULT_PORT,
            prompt: localize('configurePort', 'Configure the PORT (Application Settings) which your Java SE Web App exposes'),
            placeHolder: 'PORT',
            validateInput: (input: string): string | undefined => {
                return /^[0-9]+$/.test(input) ? undefined : localize('validPort', 'please specify a valid port number');
            }
        });
        if (!port) {
            throw new UserCancelledError('javaPort');
        }
        appSettings.properties[PORT_KEY] = port;
        return node.root.client.updateApplicationSettings(appSettings);
    }

    export async function getJavaFileExtensions(siteConfig: WebSiteManagementModels.SiteConfigResource | undefined): Promise<string | string[] | undefined> {
        if (siteConfig && isJavaRuntime(siteConfig.linuxFxVersion)) {
            return getArtifactTypeByJavaRuntime(siteConfig.linuxFxVersion);
        } else if (await isJavaProject()) {
            return getJavaArtifactExtensions();
        }

        return;
    }

}
