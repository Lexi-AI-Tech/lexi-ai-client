# System Audio Setup (BlackHole)

To capture audio from virtual meetings (Zoom, Google Meet, etc.), you need to set up **BlackHole**, a virtual audio device.

## Quick Setup (5 minutes)

### Step 1: Install BlackHole

```bash
brew install blackhole-2ch
```

### Step 2: Create Multi-Output Device

1. Open **Audio MIDI Setup** (search in Spotlight)
2. Click the **+** button (bottom left) → **Create Multi-Output Device**
3. Check both:
   - ✅ **Built-in Output** (your speakers/headphones)
   - ✅ **BlackHole 2ch**
4. Rename it to "Multi-Output + BlackHole" (optional)

### Step 3: Set System Output

1. Go to **System Settings** → **Sound** → **Output**
2. Select **Multi-Output + BlackHole**

### Step 4: Verify in Lexi AI

When you start a meeting recording, you should see:
```
✅ Recording with both microphone and system audio (BlackHole)
```

If you see:
```
⚠️ Recording with microphone only (BlackHole not found)
```

Then BlackHole is not detected. Restart Lexi AI.

## What Does This Do?

- **Without BlackHole**: Only your microphone is recorded (for in-person meetings)
- **With BlackHole**: Both your microphone AND system audio are recorded (for virtual meetings)

## Uninstall

```bash
brew uninstall blackhole-2ch
```

Then remove the Multi-Output Device from Audio MIDI Setup.

## Alternatives

If you don't want to install BlackHole:
- **In-person meetings**: Works fine with just the microphone
- **Virtual meetings**: You'll only capture your voice, not other participants

---

**Note**: This setup is identical to what Granola and Hyprnote use. It's a standard approach for meeting recorders on macOS.
