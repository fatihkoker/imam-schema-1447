// firebase-messaging-sw.js
// Hanterar push-notiser i bakgrunden (när appen inte är öppen)

importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey:            "AIzaSyA1YkZi9MPCHetCCG6XDyg2TA7AbadmT6k",
  authDomain:        "sverigesimamer.firebaseapp.com",
  projectId:         "sverigesimamer",
  storageBucket:     "sverigesimamer.firebasestorage.app",
  messagingSenderId: "860592398067",
  appId:             "1:860592398067:web:3ae1c407c498eee39e6186",
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(payload => {
  const title   = payload.notification?.title || '🎙️ Nytt Tarawih-ljud!';
  const options = {
    body:     payload.notification?.body || 'En ny recitation har laddats upp.',
    icon:     '/favicon.ico',
    badge:    '/favicon.ico',
    tag:      'new-audio',
    renotify: true,
    data:     { url: payload.data?.url || self.location.origin },
  };
  return self.registration.showNotification(title, options);
});
