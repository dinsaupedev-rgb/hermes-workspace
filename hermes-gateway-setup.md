# Hermes Gateway Connection Setup Guide

## Exposing Hermes Dashboard to Public Internet

### Option 1: Quick Tunnel (temporary, no account needed)

```bash
C:/Users/Phoenix/cloudflared.exe tunnel --url http://127.0.0.1:9119 --http-host-header 127.0.0.1
```

- Generates random `https://<name>.trycloudflare.com` URL
- URL changes every restart
- Good for testing/demos

### Option 2: Named Tunnel (permanent, needs Cloudflare account + domain)

```bash
# One-time setup
C:/Users/Phoenix/cloudflared.exe tunnel login
C:/Users/Phoenix/cloudflared.exe tunnel create hermes
C:/Users/Phoenix/cloudflared.exe tunnel route dns hermes dashboard.yourdomain.com

# Create config at C:/Users/Phoenix/.cloudflared/config.yml
# Then run anytime
C:/Users/Phoenix/cloudflared.exe tunnel run hermes
```

- Fixed URL on your domain
- Same URL every time

---

## SSH Over Public Internet

### Server side (your PC)

```bash
C:/Users/Phoenix/cloudflared.exe tunnel --url ssh://127.0.0.1:22
```

### Client side (other PC)

```bash
# Install cloudflared on client first, then:
ssh -o ProxyCommand="cloudflared access ssh --hostname %h" Phoenix@<tunnel-url>.trycloudflare.com

# Or simple (if cloudflared handles TCP proxy):
ssh Phoenix@<tunnel-url>.trycloudflare.com
```

---

## Quick Reference

| Goal | Command |
|---|---|
| Expose dashboard | `cloudflared tunnel --url http://127.0.0.1:9119 --http-host-header 127.0.0.1` |
| Expose SSH | `cloudflared tunnel --url ssh://127.0.0.1:22` |
| Stop tunnel | `taskkill /F /IM cloudflared.exe` |
| Permanent dashboard | Named tunnel with your domain |
| Permanent SSH | Named tunnel with your domain |

---

## Prerequisites

| Requirement | Quick Tunnel | Named Tunnel |
|---|---|---|
| Cloudflare account | ❌ No | ✅ Yes |
| Domain name | ❌ No | ✅ Yes (~$1-2/year for .xyz) |
| OpenSSH server | ❌ No (dashboard only) | ❌ No (dashboard only) |
| OpenSSH server | ✅ Yes (for SSH) | ✅ Yes (for SSH) |

---

## Key Notes

- **cloudflared** is installed at `C:/Users/Phoenix/cloudflared.exe`
- **OpenSSH server** is running on the machine
- No port forwarding or firewall changes needed
- Tunnel makes outbound connection only — secure by default
- For permanent access, buy a cheap domain and add it to Cloudflare

---

*Last updated: September 7, 2026*
