import { supabase } from './supabase.js';

export const auth = {
    // Get current session
    async getSession() {
        const { data: { session }, error } = await supabase.auth.getSession();
        if (error) return null;
        return session;
    },

    // Get current user profile data
    async getUser() {
        const { data: { user }, error } = await supabase.auth.getUser();
        if (error || !user) return null;
        return user;
    },

    // Redirect to login if not authenticated
    async requireAuth() {
        const session = await this.getSession();
        if (!session) {
            window.location.href = '/login.html';
        }
        return session;
    },

    // Sign out
    async signOut() {
        const { error } = await supabase.auth.signOut();
        if (!error) {
            window.location.href = '/login.html';
        }
    }
};
