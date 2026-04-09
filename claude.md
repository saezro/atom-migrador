# Atom Migrador - Claude Code Guidelines

## Release Process

The app uses `electron-updater` with GitHub releases for automatic updates. No setup or manual download links needed—users get updates automatically.

### To create a release:

1. **Commit your changes** to `main` with a descriptive message
2. **Run the build** from the `app/` directory:
   ```bash
   cd app && npm run dist
   ```
3. **Create a GitHub release** (manual via web):
   - Go to https://github.com/saezro/atom-migrador/releases
   - Click "Draft a new release"
   - **Tag version**: `v{VERSION}` (e.g., `v1.0.2`) — must match `package.json` version
   - **Release title**: `v{VERSION}`
   - **Description**: Summary of changes (optional)
   - **Attach file**: Upload `Atom Migrador Setup {VERSION}.exe` from `app/dist/`
   - Click "Publish release"

The auto-updater will detect the release and prompt users to download. No install instructions needed—the update is fully automated via the UpdateModal UI.

**Optional**: Install GitHub CLI (`gh`) to automate this:
```bash
# After installing gh and authenticating: gh auth login
gh release create v1.0.2 "app/dist/Atom Migrador Setup 1.0.2.exe" --title "v1.0.2" --notes "Update summary"
```

## Architecture Notes

- **Update flow**: `setupAutoUpdater()` in `main.ts` checks for updates on startup
- **Update modal**: `UpdateModal.tsx` handles download progress and install prompts
- **Release source**: Configured in `package.json` under `build.publish` (GitHub provider)
- **Database**: Persisted in `userData` directory (survives app updates)
- **Rclone**: Bundled with installer for offline use; also supports user-installed versions

## Known Issues

- Auto-update checks happen once on startup; users can restart the app to re-check
- Download errors are logged silently to prevent UI disruption

