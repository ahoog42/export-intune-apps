# export-intune-apps

A lightweight cli that extracts installed app from an Intune instance, enriches with metadata from the Apple App and Google Play Stores, and output the data in sqlite3, .csv and .json formats.

## Features

- Extracts installed applications from an Intune instance.
- Enriches extracted data with metadata from the Apple App Store and Google Play Store.
- Outputs data in multiple formats: SQLite3, CSV, and JSON.
- Lightweight CLI built on Node.js for fast integration in various workflows.

## Register an Azure AD app

### Step 1: Register an App in Azure AD

1. Go to [Azure Portal](https://portal.azure.com/#home).
1. Navigate to Microsoft Entra Id > Manage > App registrations > New registration.
1. Give it a name (e.g. Intune App Extract), and select the correct supported account types.
1. Click Register

### Step 2: After registering:

1. Save Application (client) ID
1. Save Directory (tenant) ID
1. Client credentials > New Client secret and store it securely.

### Step 3: Add API Permissions

1. Go to Manage > API permissions for your app registration:
1. Add permission: Microsoft Graph > Application permissions > Select permissions
1. Add DeviceManagementApps.Read.All
1. DeviceManagementManagedDevices.Read.All (optional for broader info)
1. Click Add Permission
1. Click "Grant admin consent for <account name>" and authorize the account

## Installation

### Prerequisites

- Node.js (v18 or above)
- Git

### Setup Steps

#### Step 1. Clone the repository:

```bash
  git clone https://github.com/ahoog42/export-intune-apps.git
  cd export-intune-apps
  npm install
```

#### Step 2. Create an environment configuration file:

1. Create a new `.env` file in the project root.
1. Add the following variable:

```
CLIENT_SECRET=<your-client-secret>
```

## Usage

You can run the cli as follows:

`node intune-export.js  --tenantId <your-tenant-id> --clientId <your-client-id>`

If you want to populate app metadata from the Apple App or Google Play stores, add the `--metadata` switch:

`node intune-export.js --metadata --tenantId <your-tenant-id> --clientId <your-client-id>`

## Usage

```
Usage: intune-export [options]

Options:
  --tenantId <tenantId>  Azure Tenant ID
  --clientId <clientId>  Azure Client ID
  --debug                Enable debug logging
  --metadata             Enrich app metadata
  --output <filename>    Filename (default: "intune_apps")
  -h, --help             display help for command
```

## Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository.
2. Create a new branch for your feature or bug fix.
3. Commit your changes and push the branch.
4. Open a pull request.

## License

This project is licensed under the [MIT License](LICENSE).
