// src/services/supabase.ts — replaces firebase.ts
//
// Unlike Firebase, this needs no Platform.OS branching: AsyncStorage has a
// working web shim under Expo, so the same client config works on native
// and web without a separate persistence path.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import 'react-native-url-polyfill/auto'; // RN's URL implementation is incomplete; supabase-js needs this.

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false, // no OAuth redirect flow in this app
  },
});