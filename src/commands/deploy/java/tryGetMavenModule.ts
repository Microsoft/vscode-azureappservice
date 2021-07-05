/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import * as parser from 'fast-xml-parser';
import * as fse from 'fs-extra';
import * as path from 'path';

export function tryGetMavenModule(module: string): { pom: string, artifactId: string } | undefined {
    if (fse.existsSync(module)) {
        if (fse.lstatSync(module).isDirectory() && fse.existsSync(path.join(module, 'pom.xml'))) {
            return getMavenModuleFromPom(path.join(module, 'pom.xml'));
        } else if (fse.lstatSync(module).isFile() && path.extname(module) === '.xml') {
            return getMavenModuleFromPom(module);
        }
    }
    return undefined;
}

function getMavenModuleFromPom(pomFile: string): { pom: string, artifactId: string } | undefined {
    const pomContent = fse.readFileSync(pomFile, 'utf8');
    try {
        const pom = parser.parse(pomContent) as { project: { artifactId: string }; };
        if (pom.project && pom.project.artifactId) {
            return {
                pom: pomFile,
                artifactId: pom.project.artifactId,
            } as { pom: string; artifactId: string; };
        }
    } catch (e) {
        return undefined;
    }
    return undefined;
}
