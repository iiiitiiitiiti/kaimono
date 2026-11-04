import { initializeApp } from "firebase/app";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from "firebase/firestore";

// Web 用の接続設定。公開されてよい値で、読み書きの可否は firestore.rules が決める
const firebaseConfig = {
  apiKey: "AIzaSyBs0KKe1AHx4yTYOfmyG_Z0I7nl0SKFhG4",
  authDomain: "kaimono-776d83.firebaseapp.com",
  projectId: "kaimono-776d83",
  storageBucket: "kaimono-776d83.firebasestorage.app",
  messagingSenderId: "1019606307461",
  appId: "1:1019606307461:web:8c21104a14a8611f5a8fec",
};

let db: Firestore | null = null;

/** 店の中で電波が弱くても使えるよう、端末に写しを持つ設定で開く */
export function getDb(): Firestore {
  if (db) return db;
  const app = initializeApp(firebaseConfig);
  try {
    db = initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch {
    // 端末に写しを持てない環境（プライベートブラウズなど）では写しなしで開く
    db = initializeFirestore(app, {});
  }
  return db;
}
