# ClawX Extension Apps

ClawX supports pluggable extension apps that can be independently developed, compiled, and deployed.

## Architecture

```
ClawX/
├── plugins/                    # Extension app source code
│   └── hello-world/
│       ├── src/
│       │   └── index.tsx       # React component
│       ├── manifest.json       # App metadata
│       ├── package.json        # Dependencies
│       ├── vite.config.ts      # Build config
│       └── tsconfig.json
├── dist-apps/                  # Compiled apps (gitignored)
│   └── hello-world/
│       ├── manifest.json
│       └── index.js            # Bundled component
└── ~/.openclaw/apps/           # Deployed apps (hot-loaded)
    └── hello-world/
        ├── manifest.json
        └── index.js
```

## App Types

### 1. Component Apps (React)
- **Type**: `"component"` in manifest.json
- **Rendering**: Dynamically loaded React component
- **Best for**: Rich interactive UIs with full React ecosystem support

### 2. Iframe Apps (HTML)
- **Type**: `"iframe"` in manifest.json
- **Rendering**: Sandboxed iframe with static HTML/CSS/JS
- **Best for**: Simple standalone HTML apps

## Developing an Extension App

### 1. Create Plugin Structure

```bash
mkdir -p plugins/my-app/src
cd plugins/my-app
```

### 2. Create manifest.json

```json
{
  "id": "my-app",
  "name": "My Awesome App",
  "version": "1.0.0",
  "description": "A cool extension app",
  "author": "Your Name",
  "icon": "🚀",
  "type": "component",
  "entry": "index.js"
}
```

Fields:
- `id`: Unique identifier (kebab-case)
- `type`: `"component"` or `"iframe"`
- `entry`: Entry file name (e.g., `index.js` for component, `index.html` for iframe)

### 3. Create React Component

Create `src/index.tsx`:

```tsx
import { useState } from 'react';

export default function MyApp() {
  const [count, setCount] = useState(0);

  return (
    <div style={{ padding: '2rem' }}>
      <h1>My Awesome App</h1>
      <p>Count: {count}</p>
      <button onClick={() => setCount(count + 1)}>
        Increment
      </button>
    </div>
  );
}
```

**Important**:
- Must export default the component
- Can use React hooks and full React features
- React and ReactDOM are provided as external dependencies (UMD globals)
- The component will be compiled to UMD format and loaded dynamically

### 4. Create package.json

```json
{
  "name": "my-app",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "build": "vite build"
  },
  "devDependencies": {
    "@types/react": "^19.0.7",
    "@types/react-dom": "^19.0.3",
    "@vitejs/plugin-react": "^4.3.4",
    "typescript": "^5.7.3",
    "vite": "^6.0.11"
  },
  "peerDependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  }
}
```

### 5. Create vite.config.ts

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../../dist-apps/my-app',
    emptyOutDir: true,
    lib: {
      entry: resolve(__dirname, 'src/index.tsx'),
      name: 'MyApp', // This will be the global variable name
      fileName: () => 'index.js', // Force output filename
      formats: ['umd'], // UMD format for dynamic loading
    },
    rollupOptions: {
      external: ['react', 'react-dom'],
      output: {
        globals: {
          react: 'React',
          'react-dom': 'ReactDOM',
        },
      },
    },
  },
});
```

**Important**: The `name` field will be used as the global variable name. Make sure it's unique and follows PascalCase convention (e.g., `MyApp`, `HelloWorldApp`).

### 6. Create tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "jsx": "react-jsx",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true
  },
  "include": ["src"]
}
```

## Building and Deploying

### Build Single App

```bash
pnpm apps:build my-app
```

### Build All Apps

```bash
pnpm apps:build
```

### Deploy to ~/.openclaw/apps

```bash
# Deploy all built apps
pnpm apps:deploy

# Deploy specific app
pnpm apps:deploy my-app
```

### Build + Deploy in One Command

```bash
pnpm apps:all
```

## Hot Loading

ClawX automatically:
1. Scans `~/.openclaw/apps/` on startup
2. Reads each app's `manifest.json`
3. Syncs discovered apps to `openclaw.json`
4. Displays enabled apps in the sidebar under "应用" menu

To add a new app:
1. Build and deploy the app
2. Restart ClawX (or wait for next launch)
3. App appears in sidebar automatically

## Example: Hello World

See `plugins/hello-world/` for a complete working example demonstrating:
- React component with state management
- Styled UI with gradients and animations
- Interactive buttons and event handlers
- Proper build configuration

## Troubleshooting

### App not appearing in sidebar
- Check `~/.openclaw/apps/your-app/manifest.json` exists
- Verify `manifest.json` has correct `id`, `type`, and `entry`
- Check `openclaw.json` apps section
- Restart ClawX

### Build errors
- Run `pnpm install` in plugin directory
- Check `vite.config.ts` paths are correct
- Ensure React peer dependencies match ClawX version

### Component not rendering
- Verify component exports default
- Check browser console for import errors
- Ensure entry file matches manifest `entry` field

## Best Practices

1. **Keep apps lightweight** - Minimize dependencies
2. **Use inline styles** - Avoid external CSS files for components
3. **Handle errors gracefully** - Add error boundaries
4. **Test in isolation** - Build and test before deploying
5. **Version carefully** - Update version in manifest.json on changes

## API Access

Extension apps run in the renderer process and have access to:
- React and ReactDOM
- Standard browser APIs
- ClawX window.electron APIs (if needed)

For backend integration, use the existing ClawX API infrastructure.
