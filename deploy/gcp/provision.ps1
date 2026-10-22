param(
    [string]$Project = 'rising-woods-449718-v6',
    [string]$Zone = 'us-central1-a'
)
$ErrorActionPreference = 'Stop'
$Region = $Zone -replace '-[a-z]$', ''
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$OutputDirectory = Join-Path $RepoRoot 'output/gcp'
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null

function Invoke-Gcloud {
    & gcloud @args --project=$Project --quiet
    if ($LASTEXITCODE -ne 0) { throw 'Google Cloud operation failed; inspect existing resources before resuming.' }
}

# Deliberately creates named resources once. Never deletes/replaces existing ones.
Invoke-Gcloud compute networks create scope-settle-network --subnet-mode=custom
Invoke-Gcloud compute networks subnets create scope-settle-subnet --network=scope-settle-network --region=$Region --range=10.80.0.0/24
Invoke-Gcloud compute firewall-rules create scope-settle-iap-ssh --network=scope-settle-network --direction=INGRESS --action=ALLOW --rules=tcp:22 --source-ranges=35.235.240.0/20 --target-tags=scope-settle-web
Invoke-Gcloud compute addresses create scope-settle-ip --region=$Region --network-tier=PREMIUM
Invoke-Gcloud compute routers create scope-settle-router --region=$Region --network=scope-settle-network
Invoke-Gcloud compute routers nats create scope-settle-nat --router=scope-settle-router --region=$Region --nat-custom-subnet-ip-ranges=scope-settle-subnet --nat-external-ip-pool=scope-settle-ip
Invoke-Gcloud compute disks create scope-settle-data --zone=$Zone --size=10GB --type=pd-standard --labels=app=scope-and-settle
Invoke-Gcloud compute instances create scope-and-settle --zone=$Zone --machine-type=e2-micro --provisioning-model=STANDARD --maintenance-policy=MIGRATE --network=scope-settle-network --subnet=scope-settle-subnet --no-address --tags=scope-settle-web --image-project=debian-cloud --image-family=debian-12 --boot-disk-size=20GB --boot-disk-type=pd-standard --no-boot-disk-auto-delete '--disk=name=scope-settle-data,device-name=scope-settle-data,mode=rw,boot=no,auto-delete=no' --no-service-account --no-scopes --shielded-secure-boot '--metadata=block-project-ssh-keys=true,enable-oslogin=true' --metadata-from-file="startup-script=$PSScriptRoot/bootstrap.sh" '--labels=app=scope-and-settle,purpose=hackathon-demo'
