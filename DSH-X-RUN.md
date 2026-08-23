# Run DSH-X

## On the Mac

Open Terminal and paste:

```sh
cd /Users/rome/Documents/DSH-work/deepseek-harness && node --import tsx/esm apps/cli/src/bin.ts web --patch ./dsh-x.patch.yml --port 3080
```

Your browser opens DSH-X. To stop it, come back to that Terminal window and press `Control+C`.

If Terminal says port 3080 is busy, change `3080` to `3081` and paste it again.

## On your phone or tablet

Make sure Tailscale is on, then open:

**https://romes-mac-mini.tailc8d1df.ts.net**

No port number needed. Only devices on your Tailscale account can reach it — it is not on the public internet.

Three things have to be true for the phone to work:

1. The Mac is awake (not asleep).
2. The Terminal command above is still running.
3. Tailscale is connected on the phone.

If the page does not load, it is almost always #1 or #2.

### Turning phone access off

```sh
tailscale serve --https=443 off
```

To turn it back on later:

```sh
tailscale serve --bg 3080
```

## Using it

Open **Models** and add your DeepSeek API key. Without a key DSH-X still opens and you can
look around, but the agents cannot do work.

## Worth knowing

Anyone signed in to your Tailscale account can reach this page, and this app can run commands
on the Mac. That is fine for your own devices. Do not turn on `tailscale funnel`, which would
put it on the public internet.
