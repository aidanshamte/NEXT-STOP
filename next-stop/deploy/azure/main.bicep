// NEXT STOP pilot infrastructure: one Linux VM running the API (SQLite on an attached
// managed disk), Caddy for HTTPS/WSS, a private storage account for backups and release
// packages, CPU alert and a monthly budget. Deploy into an empty resource group:
//   az deployment group create -g nextstop-pilot -f deploy/azure/main.bicep -p @deploy/azure/main.parameters.json
// Single instance by design: the realtime event hub is in-process.

@description('Azure region. Azure for Students subscriptions may only allow certain regions.')
param location string = resourceGroup().location

@description('Short prefix for resource names: lowercase letters and digits only (it is part of the storage account name).')
@minLength(3)
@maxLength(12)
param prefix string = 'nextstop'

@description('DNS label: the API will be https://<label>.<region>.cloudapp.azure.com. Must be unique in the region.')
@minLength(3)
@maxLength(40)
param dnsLabel string

@description('VM size. B2ats v2 / B2pts v2 / B1s have 750 free hours per month for 12 months on eligible new accounts.')
@allowed(['Standard_B2ats_v2', 'Standard_B1s', 'Standard_B2s'])
param vmSize string = 'Standard_B2ats_v2'

param adminUsername string = 'nextstopadmin'

@description('Your SSH public key (contents of ~/.ssh/id_ed25519.pub). Password login is disabled.')
@secure()
param sshPublicKey string

@description('Your public IP in CIDR form (for example 203.0.113.10/32). SSH is closed to everyone else.')
param sshSourceAddress string

@description('Data disk size (GiB) holding the database and local backups.')
@minValue(4)
@maxValue(64)
param dataDiskGb int = 8

@description('Email address for alert and budget notifications.')
param alertEmail string

@description('Monthly budget (USD) that triggers notification emails at 50%, 80% and 100%.')
param monthlyBudget int = 15

@description('First day of the current month, YYYY-MM-01. Budgets must start on a month boundary.')
param budgetStartDate string

@description('Optional object ID of the GitHub Actions deployment service principal (OIDC). Empty skips its role assignments.')
param deployerPrincipalId string = ''

var storageName = take('${prefix}${uniqueString(resourceGroup().id)}', 24)
var fqdn = '${dnsLabel}.${location}.cloudapp.azure.com'
var blobEndpoint = 'https://${storageName}.blob.${environment().suffixes.storage}'
var cloudInit = replace(
  replace(
    replace(loadTextContent('cloud-init.yaml'), '__DOMAIN__', fqdn),
    '__RELEASE_URL__',
    '${blobEndpoint}/releases'
  ),
  '__BACKUP_URL__',
  '${blobEndpoint}/backups'
)
var roles = {
  storageBlobDataContributor: 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'
  virtualMachineContributor: '9980e02c-c2be-4d73-94e8-173b1dc7cf3c'
}

resource nsg 'Microsoft.Network/networkSecurityGroups@2024-05-01' = {
  name: '${prefix}-nsg'
  location: location
  properties: {
    securityRules: [
      {
        name: 'https'
        properties: {
          priority: 100
          direction: 'Inbound'
          access: 'Allow'
          protocol: 'Tcp'
          sourceAddressPrefix: '*'
          sourcePortRange: '*'
          destinationAddressPrefix: '*'
          destinationPortRange: '443'
        }
      }
      {
        // Needed for the Let's Encrypt HTTP challenge and HTTP->HTTPS redirect.
        name: 'http-acme'
        properties: {
          priority: 110
          direction: 'Inbound'
          access: 'Allow'
          protocol: 'Tcp'
          sourceAddressPrefix: '*'
          sourcePortRange: '*'
          destinationAddressPrefix: '*'
          destinationPortRange: '80'
        }
      }
      {
        name: 'ssh-operator-only'
        properties: {
          priority: 120
          direction: 'Inbound'
          access: 'Allow'
          protocol: 'Tcp'
          sourceAddressPrefix: sshSourceAddress
          sourcePortRange: '*'
          destinationAddressPrefix: '*'
          destinationPortRange: '22'
        }
      }
    ]
  }
}

resource vnet 'Microsoft.Network/virtualNetworks@2024-05-01' = {
  name: '${prefix}-vnet'
  location: location
  properties: {
    addressSpace: { addressPrefixes: ['10.40.0.0/24'] }
    subnets: [
      {
        name: 'api'
        properties: {
          addressPrefix: '10.40.0.0/26'
          networkSecurityGroup: { id: nsg.id }
        }
      }
    ]
  }
}

resource publicIp 'Microsoft.Network/publicIPAddresses@2024-05-01' = {
  name: '${prefix}-ip'
  location: location
  sku: { name: 'Standard' }
  properties: {
    publicIPAllocationMethod: 'Static'
    dnsSettings: { domainNameLabel: dnsLabel }
  }
}

resource nic 'Microsoft.Network/networkInterfaces@2024-05-01' = {
  name: '${prefix}-nic'
  location: location
  properties: {
    ipConfigurations: [
      {
        name: 'primary'
        properties: {
          subnet: { id: vnet.properties.subnets[0].id }
          privateIPAllocationMethod: 'Dynamic'
          publicIPAddress: { id: publicIp.id }
        }
      }
    ]
  }
}

// Separate managed disk: the database survives VM rebuilds and redeployments.
resource dataDisk 'Microsoft.Compute/disks@2024-03-02' = {
  name: '${prefix}-data'
  location: location
  sku: { name: 'StandardSSD_LRS' }
  properties: {
    creationData: { createOption: 'Empty' }
    diskSizeGB: dataDiskGb
  }
}

resource vm 'Microsoft.Compute/virtualMachines@2024-07-01' = {
  name: '${prefix}-api'
  location: location
  identity: { type: 'SystemAssigned' }
  properties: {
    hardwareProfile: { vmSize: vmSize }
    osProfile: {
      computerName: '${prefix}-api'
      adminUsername: adminUsername
      customData: base64(cloudInit)
      linuxConfiguration: {
        disablePasswordAuthentication: true
        ssh: {
          publicKeys: [
            {
              path: '/home/${adminUsername}/.ssh/authorized_keys'
              keyData: sshPublicKey
            }
          ]
        }
        patchSettings: { patchMode: 'ImageDefault' }
      }
    }
    storageProfile: {
      imageReference: {
        publisher: 'Canonical'
        offer: 'ubuntu-24_04-lts'
        sku: 'server'
        version: 'latest'
      }
      osDisk: {
        createOption: 'FromImage'
        diskSizeGB: 30
        managedDisk: { storageAccountType: 'StandardSSD_LRS' }
        deleteOption: 'Delete'
      }
      dataDisks: [
        {
          lun: 0
          createOption: 'Attach'
          managedDisk: { id: dataDisk.id }
          deleteOption: 'Detach'
        }
      ]
    }
    networkProfile: { networkInterfaces: [{ id: nic.id }] }
    diagnosticsProfile: { bootDiagnostics: { enabled: true } }
  }
}

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageName
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    accessTier: 'Cool'
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false // Entra ID (managed identity / OIDC) only; no account keys in use.
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
  properties: {
    deleteRetentionPolicy: { enabled: true, days: 7 }
  }
}

resource backupsContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'backups'
  properties: { publicAccess: 'None' }
}

resource releasesContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'releases'
  properties: { publicAccess: 'None' }
}

// Backups contain personal data: keep 35 days, then delete. Old release packages expire after 120 days.
resource lifecycle 'Microsoft.Storage/storageAccounts/managementPolicies@2023-05-01' = {
  parent: storage
  name: 'default'
  properties: {
    policy: {
      rules: [
        {
          name: 'expire-backups'
          enabled: true
          type: 'Lifecycle'
          definition: {
            filters: { blobTypes: ['blockBlob'], prefixMatch: ['backups/'] }
            actions: { baseBlob: { delete: { daysAfterModificationGreaterThan: 35 } } }
          }
        }
        {
          name: 'expire-releases'
          enabled: true
          type: 'Lifecycle'
          definition: {
            filters: { blobTypes: ['blockBlob'], prefixMatch: ['releases/'] }
            actions: { baseBlob: { delete: { daysAfterModificationGreaterThan: 120 } } }
          }
        }
      ]
    }
  }
}

resource vmBlobAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: storage
  name: guid(storage.id, vm.id, roles.storageBlobDataContributor)
  properties: {
    principalId: vm.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.storageBlobDataContributor)
  }
}

resource deployerBlobAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(deployerPrincipalId)) {
  scope: storage
  name: guid(storage.id, deployerPrincipalId, roles.storageBlobDataContributor)
  properties: {
    principalId: deployerPrincipalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.storageBlobDataContributor)
  }
}

// Lets GitHub Actions use Run Command on this VM only (no SSH port open to GitHub).
resource deployerVmAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(deployerPrincipalId)) {
  scope: vm
  name: guid(vm.id, deployerPrincipalId, roles.virtualMachineContributor)
  properties: {
    principalId: deployerPrincipalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.virtualMachineContributor)
  }
}

resource alerts 'Microsoft.Insights/actionGroups@2023-01-01' = {
  name: '${prefix}-alerts'
  location: 'global'
  properties: {
    groupShortName: 'nextstop'
    enabled: true
    emailReceivers: [{ name: 'operator', emailAddress: alertEmail, useCommonAlertSchema: true }]
  }
}

resource cpuAlert 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: '${prefix}-cpu-high'
  location: 'global'
  properties: {
    description: 'NEXT STOP API VM CPU above 85% for 15 minutes.'
    severity: 2
    enabled: true
    scopes: [vm.id]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT15M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          name: 'cpu'
          criterionType: 'StaticThresholdCriterion'
          metricName: 'Percentage CPU'
          operator: 'GreaterThan'
          threshold: 85
          timeAggregation: 'Average'
        }
      ]
    }
    actions: [{ actionGroupId: alerts.id }]
  }
}

resource budget 'Microsoft.Consumption/budgets@2023-11-01' = {
  name: '${prefix}-monthly'
  properties: {
    category: 'Cost'
    amount: monthlyBudget
    timeGrain: 'Monthly'
    timePeriod: { startDate: budgetStartDate }
    notifications: {
      actual50: { enabled: true, operator: 'GreaterThan', threshold: 50, contactEmails: [alertEmail], thresholdType: 'Actual' }
      actual80: { enabled: true, operator: 'GreaterThan', threshold: 80, contactEmails: [alertEmail], thresholdType: 'Actual' }
      forecast100: { enabled: true, operator: 'GreaterThan', threshold: 100, contactEmails: [alertEmail], thresholdType: 'Forecasted' }
    }
  }
}

output apiUrl string = 'https://${fqdn}'
output vmName string = vm.name
output storageAccount string = storage.name
output vmPrincipalId string = vm.identity.principalId
