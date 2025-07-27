# 🔐 Google OAuth 2.0 Setup Guide

This guide walks you through setting up Google OAuth 2.0 integration for the Voice Appointment System to connect with Google Calendar.

## 📋 Prerequisites

- Firebase project deployed (already done ✅)
- Google Cloud Console access
- Google Calendar API enabled

## 🚀 Step-by-Step Setup

### 1. **Create Google Cloud Project & OAuth Credentials**

1. **Go to Google Cloud Console:**
   - Visit: https://console.cloud.google.com/
   - Select your Firebase project (or create a new one)

2. **Enable Google Calendar API:**
   ```
   Navigation: APIs & Services > Library
   Search: "Google Calendar API"
   Click: Enable
   ```

3. **Create OAuth 2.0 Credentials:**
   ```
   Navigation: APIs & Services > Credentials
   Click: + CREATE CREDENTIALS > OAuth 2.0 Client IDs
   Application type: Web application
   Name: Voice Appointment System
   ```

4. **Configure Authorized Redirect URIs:**
   ```
   Add this URI to "Authorized redirect URIs":
   https://us-central1-learning-auth-e6ea2.cloudfunctions.net/googleOAuthCallback
   ```

5. **Save and Download:**
   - Click "Create"
   - Copy the `Client ID` and `Client Secret`

### 2. **Configure Firebase Environment Variables**

Add the Google OAuth credentials to your Firebase Functions environment:

```bash
# Method 1: Using .env file (for local development)
cd functions
echo "GOOGLE_CLIENT_ID=your_client_id_here.apps.googleusercontent.com" >> .env
echo "GOOGLE_CLIENT_SECRET=your_client_secret_here" >> .env
```

```bash
# Method 2: Using Firebase CLI (for production)
firebase functions:config:set google.client_id="your_client_id_here.apps.googleusercontent.com"
firebase functions:config:set google.client_secret="your_client_secret_here"
```

### 3. **Test OAuth Flow**

Your OAuth callback function is now deployed at:
```
https://us-central1-learning-auth-e6ea2.cloudfunctions.net/googleOAuthCallback
```

## 🔗 OAuth Authorization URL

To start the OAuth flow, redirect users to this URL (replace USER_UID with actual Firebase Auth UID):

```
https://accounts.google.com/o/oauth2/v2/auth?
  client_id=YOUR_CLIENT_ID&
  redirect_uri=https://us-central1-learning-auth-e6ea2.cloudfunctions.net/googleOAuthCallback&
  scope=https://www.googleapis.com/auth/calendar.events%20https://www.googleapis.com/auth/userinfo.profile%20https://www.googleapis.com/auth/userinfo.email&
  response_type=code&
  state=USER_FIREBASE_AUTH_UID&
  access_type=offline&
  prompt=consent
```

**Parameters Explained:**
- `client_id`: Your Google OAuth Client ID
- `redirect_uri`: Your deployed Firebase Function URL
- `scope`: Calendar events, profile, and email access
- `state`: **Firebase Auth User UID** (obtained after user authentication)
- `access_type=offline`: Gets refresh token
- `prompt=consent`: Forces consent screen (ensures refresh token)

## 📱 iOS Integration

### Swift Example with Firebase Auth:
```swift
import AuthenticationServices
import FirebaseAuth

class OAuthManager: NSObject, ASWebAuthenticationSessionDelegate {
    func startGoogleOAuth() {
        // First, ensure user is authenticated with Firebase
        guard let currentUser = Auth.auth().currentUser else {
            print("User must be authenticated with Firebase first")
            return
        }
        
        let clientId = "YOUR_CLIENT_ID"
        let redirectUri = "https://us-central1-learning-auth-e6ea2.cloudfunctions.net/googleOAuthCallback"
        let state = currentUser.uid // Use Firebase Auth UID
        
        let authURL = "https://accounts.google.com/o/oauth2/v2/auth" +
                     "?client_id=\(clientId)" +
                     "&redirect_uri=\(redirectUri)" +
                     "&scope=https://www.googleapis.com/auth/calendar.events%20https://www.googleapis.com/auth/userinfo.profile%20https://www.googleapis.com/auth/userinfo.email" +
                     "&response_type=code" +
                     "&state=\(state)" +
                     "&access_type=offline" +
                     "&prompt=consent"
        
        guard let url = URL(string: authURL) else { return }
        
        let session = ASWebAuthenticationSession(url: url, callbackURLScheme: "https") { [weak self] callbackURL, error in
            if let error = error {
                print("OAuth error: \(error)")
            } else {
                print("OAuth completed successfully for user: \(currentUser.uid)")
            }
        }
        
        session.delegate = self
        session.presentationContextProvider = self
        session.start()
    }
}
```

### Firebase Auth Setup Required:
Before using Google Calendar integration, users must:

1. **Sign in with Firebase Auth** (Email/Password, Google Sign-In, etc.)
2. **Get authenticated user UID** (`Auth.auth().currentUser?.uid`)
3. **Use the UID as the state parameter** in OAuth flow

## 🔍 Testing the OAuth Flow

1. **Test URL (replace YOUR_CLIENT_ID and USER_UID):**
   ```
   https://accounts.google.com/o/oauth2/v2/auth?client_id=YOUR_CLIENT_ID&redirect_uri=https://us-central1-learning-auth-e6ea2.cloudfunctions.net/googleOAuthCallback&scope=https://www.googleapis.com/auth/calendar.events%20https://www.googleapis.com/auth/userinfo.profile%20https://www.googleapis.com/auth/userinfo.email&response_type=code&state=USER_FIREBASE_AUTH_UID&access_type=offline&prompt=consent
   ```

2. **Expected Flow:**
   - User is authenticated with Firebase Auth first
   - User sees Google consent screen
   - User grants permissions
   - Google redirects to your Firebase Function
   - Function exchanges code for tokens
   - Tokens stored in Firestore with real user UID
   - User sees success page

3. **Check Firestore:**
   ```
   Collection: artifacts/my-voice-calendly-app/users/{REAL_USER_UID}/tokens/googleCalendar
   
   Document should contain:
   - access_token
   - refresh_token (if first-time auth)
   - expiry_date
   - scopes
   - last_updated
   ```

## 🐛 Troubleshooting

### Common Issues:

1. **"redirect_uri_mismatch"**
   - Ensure the redirect URI in Google Cloud Console exactly matches your function URL
   - Check for trailing slashes or typos

2. **"invalid_client"**
   - Verify Client ID and Client Secret are correct
   - Check environment variables are properly set

3. **"access_denied"**
   - User declined permissions
   - Try again with proper consent

4. **Missing refresh_token**
   - Add `access_type=offline` and `prompt=consent` to auth URL
   - Refresh tokens are only provided on first authorization

### Debug Steps:

1. **Check Firebase Logs:**
   ```bash
   firebase functions:log --only googleOAuthCallback
   ```

2. **Test Function Directly:**
   ```bash
   curl "https://us-central1-learning-auth-e6ea2.cloudfunctions.net/googleOAuthCallback?code=test&state=test-user"
   ```

3. **Verify Environment Variables:**
   ```bash
   firebase functions:config:get
   ```

## ✅ Success Indicators

- ✅ Google Calendar API enabled
- ✅ OAuth credentials created and configured
- ✅ Redirect URI matches exactly
- ✅ Environment variables set
- ✅ Function deployed successfully
- ✅ Test flow completes without errors
- ✅ Tokens stored in Firestore

## 🔐 Security Notes

- **Client Secret**: Keep secure, never expose in client-side code
- **Refresh Tokens**: Store securely, use for long-term access
- **Access Tokens**: Short-lived, refresh as needed
- **State Parameter**: Use for CSRF protection in production

## 📞 Support

- Firebase Functions logs: `firebase functions:log`
- Google OAuth documentation: https://developers.google.com/identity/protocols/oauth2
- Firebase documentation: https://firebase.google.com/docs/functions

---

**Your Google OAuth integration is ready! 🎉** 