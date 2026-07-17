// js/firebase-config.js
// -----------------------------------------------------------------------------
// Firebase project configuration for Housekeeping Hub.
//
// WHERE TO FIND THESE VALUES:
//   Firebase Console (https://console.firebase.google.com)
//   > select your project
//   > gear icon (Project settings) > General tab
//   > scroll to "Your apps" > select your Web app
//   > "SDK setup and configuration" > choose "Config"
//   Copy each value from the firebaseConfig object shown there.
//
// The values below are the live config for project housekeeping-app-4684b.
// Replace them if you point this app at a different Firebase project.
// NOTE: these Web API values are NOT secrets - Firebase security is enforced by
// Firestore/Storage security rules, not by hiding this config. See firestore.rules.
// -----------------------------------------------------------------------------

var firebaseConfig = {
  apiKey: "AIzaSyB9oh9GOnrF7H65tOc6IkME7Fhj9D-wul8",           // Project settings > General > Web API Key
  authDomain: "housekeeping-app-4684b.firebaseapp.com",        // <projectId>.firebaseapp.com
  projectId: "housekeeping-app-4684b",                         // Project settings > General > Project ID
  storageBucket: "housekeeping-app-4684b.appspot.com",         // <projectId>.appspot.com
  messagingSenderId: "REPLACE_WITH_SENDER_ID",                 // Project settings > Cloud Messaging > Sender ID
  appId: "REPLACE_WITH_APP_ID"                                 // Project settings > General > Your apps > App ID
};

// Initialise Firebase (compat SDK, loaded via CDN script tags on each page).
firebase.initializeApp(firebaseConfig);

// Shared handles used across the app.
var auth = firebase.auth();
var db = firebase.firestore();
var storage = firebase.storage();
