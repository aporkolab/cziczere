# Archived Firebase deployment account setup

Cloud deployment is disabled. The current CI workflow requires no Google Cloud service account. The following settings describe the former deployment.

## Required Service Account Roles

Your service account needs these IAM roles in Google Cloud Console:

### Core Roles:
1. **Editor** or **Project Editor** - Basic project access
2. **Firebase Admin** - Full Firebase access
3. **Cloud Functions Admin** - Deploy Cloud Functions
4. **Firebase Hosting Admin** - Deploy to Firebase Hosting
5. **Service Usage Admin** - Enable/use APIs

### Additional Roles (if needed):
- **Cloud Build Editor** - For building functions
- **Storage Admin** - For Firebase Storage
- **Cloud Resource Manager Project IAM Admin** - For project-level operations

## How to Add Roles

### Option 1: Google Cloud Console (Recommended)
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Select your project: **cziczere-ai**
3. Navigate to **IAM & Admin** → **IAM**
4. Find your service account (the email from your `GCP_SA_KEY` secret)
5. Click **Edit** (pencil icon)
6. Click **Add Another Role** for each role above
7. **Save**

### Option 2: gcloud CLI (if you have access)
```bash
# Set your service account email
SERVICE_ACCOUNT_EMAIL="your-service-account@cziczere-ai.iam.gserviceaccount.com"
PROJECT_ID="cziczere-ai"

# Add required roles
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:$SERVICE_ACCOUNT_EMAIL" \
    --role="roles/editor"

gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:$SERVICE_ACCOUNT_EMAIL" \
    --role="roles/firebase.admin"

gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:$SERVICE_ACCOUNT_EMAIL" \
    --role="roles/cloudfunctions.admin"

gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:$SERVICE_ACCOUNT_EMAIL" \
    --role="roles/firebasehosting.admin"

gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:$SERVICE_ACCOUNT_EMAIL" \
    --role="roles/serviceusage.serviceUsageAdmin"
```

## APIs to Enable

Make sure these APIs are enabled in your project:

1. **Cloud Resource Manager API**
2. **Firebase Management API**
3. **Cloud Functions API**
4. **Firebase Hosting API**
5. **Cloud Build API**

**Quick Enable Link:**
https://console.cloud.google.com/flows/enableapi?apiid=cloudresourcemanager.googleapis.com,firebase.googleapis.com,cloudfunctions.googleapis.com,firebasehosting.googleapis.com,cloudbuild.googleapis.com&project=cziczere-ai

## Troubleshooting

### If you still get permission errors:
1. **Double-check the service account email** in your GitHub secret matches the one with roles
2. **Verify all APIs are enabled** and activated
3. **Wait a few more minutes** - IAM changes can take time
4. **Check if your project has billing enabled** - some APIs require billing

### If you can't find your service account:
1. Go to **IAM & Admin** → **Service Accounts**
2. **Create a new service account** if needed
3. **Download the JSON key** and update your `GCP_SA_KEY` GitHub secret
