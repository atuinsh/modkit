import starlight from '@astrojs/starlight'
import { defineConfig } from 'astro/config'

export default defineConfig({
  integrations: [
    starlight({
      title: 'modkit',
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/atuinsh/modkit' }],
      editLink: { baseUrl: 'https://github.com/atuinsh/modkit/edit/main/docs/' },
    }),
  ],
})
