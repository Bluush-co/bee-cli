# bee-cli

CLI client for bee.computer.

## Usage

```bash
bee <command> [options]

# Examples
bee ping
bee ping --count 3
bee version
```

## Commands

- `ping` - Simple connectivity check.
- `version` - Print CLI version information.

## Build

```bash
bun run build
```

The binary is emitted to `dist/bee`.

## Development

```bash
bun run dev -- <command>
```
