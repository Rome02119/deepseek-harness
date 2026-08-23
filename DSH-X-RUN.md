# Run DSH-X

Open Terminal and paste:

```sh
cd /Users/rome/Documents/DSH-work/deepseek-harness && node --import tsx/esm apps/cli/src/bin.ts web --patch ./dsh-x.patch.yml --port 3080
```

Your browser opens DSH. Open **Models** and add your DeepSeek API key, then start a new chat and say, “Use Agent Teams to do this task.” Team activity will appear in the chat. Without a key, DSH still opens, but the agents cannot work.

To stop DSH, return to Terminal and press:

```text
Control+C
```

If Terminal says port 3080 is busy, change `3080` to `3081` in the start command and paste it again.
