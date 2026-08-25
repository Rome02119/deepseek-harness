# DSH-X auto-start

Install after reviewing `ops/dsh-x.plist`:

```sh
mkdir -p ~/Library/Logs
cp ops/dsh-x.plist ~/Library/LaunchAgents/ai.deepseek.dsh-x.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/ai.deepseek.dsh-x.plist
```

Unload it with:

```sh
launchctl bootout gui/$(id -u)/ai.deepseek.dsh-x
```

The LaunchAgent starts at login, restarts after exit, and writes stdout/stderr to `~/Library/Logs/dsh-x.log` and `~/Library/Logs/dsh-x.error.log`. This repo does not install it automatically.
