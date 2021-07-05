/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import * as fse from 'fs-extra';
import * as JSZip from "jszip";
import * as vscode from 'vscode';

export async function tryGetDeployableArtifacts(targetFolder: string, fileExtensions: string[] = ['jar', 'war']): Promise<string[] | undefined> {
    if (!fileExtensions || !targetFolder || !fse.pathExistsSync(targetFolder)) {
        return undefined;
    }
    return (await Promise.all(fileExtensions.map(async ext => {
        const relativeDirectory: vscode.RelativePattern | string = new vscode.RelativePattern(targetFolder, `**/*.${ext}`);
        const uris = await vscode.workspace.findFiles(relativeDirectory);
        return uris.map(u => u.fsPath).filter(async u => ext.toLowerCase() !== 'jar' || await isExecutableJarFile(u));
    }))).reduce((acc, val) => acc.concat(val), []);
}

async function isExecutableJarFile(fsPath: string): Promise<boolean> {
    const fileContent: Buffer = await fse.readFile(fsPath);
    const zip: JSZip = await JSZip.loadAsync(fileContent);
    const manifest: string | undefined = await zip.file("META-INF/MANIFEST.MF")?.async("text");
    return !!(manifest && manifest.toLowerCase().includes("main-class"));
}
