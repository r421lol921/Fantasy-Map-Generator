import {defineConfig} from 'vite';

export default defineConfig({
    root: './src',
    // Use '/' in dev (v0 preview) and production Vercel deployments.
    // Only use the sub-path on Netlify where the repo is hosted under that path.
    base: process.env.NETLIFY ? '/Fantasy-Map-Generator/' : '/',
    build: {
        outDir: '../dist',
        assetsDir: './',
    },
    publicDir: '../public',
    // Expose Supabase credentials to the HTML via import.meta.env
    define: {
        'import.meta.env.SUPABASE_URL': JSON.stringify(
            process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || ''
        ),
        'import.meta.env.SUPABASE_ANON_KEY': JSON.stringify(
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
        ),
    },
    // Replace %VITE_SUPABASE_*% tokens in index.html
    plugins: [
        {
            name: 'supabase-env-html',
            transformIndexHtml(html) {
                const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
                const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
                const envScript = `<script>window.ENV={SUPABASE_URL:"${supabaseUrl}",SUPABASE_ANON_KEY:"${supabaseKey}"};<\/script>`;
                return html
                    .replace(/<\/head>/, `${envScript}</head>`)
                    .replace(/%VITE_SUPABASE_URL%/g, supabaseUrl)
                    .replace(/%VITE_SUPABASE_ANON_KEY%/g, supabaseKey);
            }
        }
    ]
});
