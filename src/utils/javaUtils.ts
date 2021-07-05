/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { WebSiteManagementModels } from "@azure/arm-appservice";
import { SiteConfigResource } from "@azure/arm-appservice/esm/models";
import * as fse from 'fs-extra';
import * as path from 'path';
import { workspace } from "vscode";
import { UserCancelledError } from 'vscode-azureextensionui';
import { ext } from '../extensionVariables';
import { localize } from "../localize";
import { SiteTreeItem } from "../tree/SiteTreeItem";

export namespace javaUtils {
    const DEFAULT_PORT: string = '8080';
    const PORT_KEY: string = 'PORT';
    const JAVA_WEB_CONTAINER_REGEX: RegExp = /^(tomcat|wildfly|jboss)/i;
    const JAVA_SE_REGEX: RegExp = /^java/i;

    function isJavaWebContainerRuntime(runtime: SiteConfigResource | undefined): boolean {
        return (!!runtime?.javaContainer && (JAVA_WEB_CONTAINER_REGEX.test(runtime.javaContainer)) || (!!runtime?.linuxFxVersion && JAVA_WEB_CONTAINER_REGEX.test(runtime.linuxFxVersion)));
    }

    function isJavaSERuntime(runtime: SiteConfigResource | undefined): boolean {
        return (!!runtime?.javaContainer && (JAVA_SE_REGEX.test(runtime.javaContainer)) || (!!runtime?.linuxFxVersion && JAVA_SE_REGEX.test(runtime.linuxFxVersion)));
    }

    export function isJavaRuntime(siteConfig: SiteConfigResource | undefined): boolean {
        return isJavaWebContainerRuntime(siteConfig) || isJavaSERuntime(siteConfig);
    }

    function isJavaArtifact(artifactPath: string): boolean {
        return /^(.jar|.war)/i.test(path.extname(artifactPath));
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

    export async function configureJavaSEAppSettings(node: SiteTreeItem): Promise<WebSiteManagementModels.StringDictionary | undefined> {
        const appSettings: WebSiteManagementModels.StringDictionary = await node.root.client.listApplicationSettings();
        if (isJavaSERequiredPortConfigured(appSettings)) {
            return undefined;
        }

        appSettings.properties = appSettings.properties || {};
        const port: string = await ext.ui.showInputBox({
            value: DEFAULT_PORT,
            prompt: localize('configurePort', 'Configure the PORT (Application Settings) which your Java SE Web App exposes'),
            placeHolder: 'PORT',
            validateInput: (input: string): string | undefined => {
                return /^[0-9]+$/.test(input) ? undefined : localize('validPort', 'please specify a valid port number');
            }
        });
        if (!port) {
            throw new UserCancelledError();
        }
        appSettings.properties[PORT_KEY] = port;
        return node.root.client.updateApplicationSettings(appSettings);
    }

    export async function getJavaFileExtensions(siteConfig: WebSiteManagementModels.SiteConfigResource | undefined): Promise<string[] | undefined> {
        if (isJavaSERuntime(siteConfig)) {
            return ['jar'];
        } else if (isJavaWebContainerRuntime(siteConfig)) {
            return ['war'];
        } else if (await isJavaProject()) {
            return getJavaArtifactExtensions();
        }
        return;
    }
}
