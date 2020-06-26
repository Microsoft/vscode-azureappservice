# Welcome to your Trial App Didact Tutorial

This guide will show you how to make and deploy changes to your Azure App Service Trial App. Your trial will last 60 minutes. You can find more information about Azure App Service [here](https://docs.microsoft.com/en-us/azure/app-service/).

## Getting Started

### Step 1: Clone the trial app source code

1. Locate your imported Trial App in the Azure view.

<img src="./trialAppTutorial/viewTrialAppScreenshot.png" style="width: 256px;">

2. Right click on the Trial App.
3. Select `Clone`.

<img src="./trialAppTutorial/rightClickCloneScreenshot.png" style="width: 256px;">

4. Select the cloned repository's location.
5. When the repository has finished cloning a notification like the one below will appear. Open the folder in VS Code or add it to the workspace.

<img src="./trialAppTutorial/cloneNotificationScreenshot.png" style="width: 256px;">

### Step 2: Make some changes to your app

Make some changes to your trial app. Try changing some text in `template.html`.

For example, change line 26 from: `<h1> Welcome to Azure! </h1>` to this: `<h1> Hello, world! </h1>`

[Click here](didact://?commandId=workbench.view.explorer) to view the project files in the Explorer.

### Step 3: Deploy your changes

1. Select the blue up arrow icon to deploy your code to your Trial App.

<img src="./trialAppTutorial/deployButtonScreenshot.png" style="width: 256px;">

2. Select the folder containing the Trial App code you cloned and modified.

<img src="./trialAppTutorial/selectFolderToDeployScreenshot.png" style="width: 512px;">

3. Select your Trial App.

<img src="./trialAppTutorial/selectTrialAppDeployScreenshot.png" style="width: 512px;">

4. You will see the following notification once your deployment is complete. You can click `Browse` to view the changes live.

<img src="./trialAppTutorial/deployCompleteScreenshot.png" style="width: 512px;">

You can also browse your website by right-clicking your Trial app and selecting `Browse`.

<img src="./trialAppTutorial/browseWebsiteRedScreenshot.png" style="width: 256px;">

---

This tutorial is made with [vscode-didact](https://github.com/redhat-developer/vscode-didact).
