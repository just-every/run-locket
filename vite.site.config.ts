import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { seedIcons } from '@runeditrun/rer/seed-icons'
import { docsSite } from './src/site/docs/build/plugin.ts'

// The run site's build (rer build --site, src/site/pages.tsx): the docs module and React, never the app's
// vite.config.ts, whose Worker and Start plugins do not run in Node.
export default defineConfig({ plugins: [seedIcons(), docsSite(), react()] })
