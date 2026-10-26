// Firebase istemcisinin (yalnızca kullanılan parçalar) arayüz için paketlenen giriş noktası → src/vendor/cloud.js
// Arayüz kodu bunlara window.CloudSDK üzerinden ulaşır (js/cloud.js); başka hiçbir yer Firebase'i doğrudan bilmez.
import { initializeApp } from 'firebase/app';
import {
  initializeAuth, browserLocalPersistence, connectAuthEmulator, onAuthStateChanged,
  signInWithEmailAndPassword, signOut, sendPasswordResetEmail,
} from 'firebase/auth';

window.CloudSDK = {
  initializeApp,
  initializeAuth, browserLocalPersistence, connectAuthEmulator, onAuthStateChanged,
  signInWithEmailAndPassword, signOut, sendPasswordResetEmail,
};
