# Sync and recovering a lost device

Sync is **optional**. Réussite works fully on one device. Turn it on if you use more than one.

![Sync & devices](shot:sync)

## How it works

Your list is scrambled (encrypted) on your device before it is sent. Only your devices hold the key. It catches up when you open the app, and a couple of seconds after you change something. If two devices change the same thing, the later change wins, field by field. Nothing is lost.

## Set it up

1. Settings → **Sync & devices** → **Set up sync**.
2. **Make my recovery key.** It is a long key of 14 groups of 4 characters, shown as letters and a QR code.
3. **Save it now**, in a password manager, printed on paper, or as a photo kept somewhere safe.
4. Tap **I've saved it**. Until you do, a card reminds you.

> **If you lose every device and the recovery key, your list is gone.** Nobody can get it back: not us, and not whoever runs the relay.

## Add another device

On the new device, open Réussite, then Settings → Sync & devices → **Join with a recovery key**. Or, on a brand new device, choose **I already use Réussite on another device** on the first screen. Scan the QR code, or type the key. Spaces, dashes and lower case don't matter. If you mix up I, L and O with 1 and 0, it still reads it. A typo is caught by the check at the end.

What was on the new device stays: it is added to your list, never replaced.

## Recovering a lost device

**You lost your phone, but you have another device.**
1. On the other device, open Settings → Sync & devices. Your devices are listed, with when each was last seen.
2. Get a new device, install Réussite, and join with the recovery key. **Show recovery key** on the working device shows it again.

**You lost every device, but you kept the key.** Install Réussite on the new device, join with the key, and your list comes back from the scrambled copy.

**You lost every device and the key.** The list is gone. If you saved a backup file, **Restore a backup** brings it back (an encrypted backup needs the key, so use a plain one for this). This is why Réussite reminds you to keep both.

**You think someone else has your key.** Delete the synced copy and set sync up again. This makes a new key. Only a new recovery key fully undoes a key that was shared.

## Managing sync

- **Sync now**, and when it last synced.
- **Name of this device.**
- **Turn sync off.** Your list stays on this device. This device forgets the key and stops syncing. The scrambled copy stays for your other devices.
- **Delete everywhere.** Deletes the scrambled copy from the relay, and sync stops on every device. Each device keeps the list it has. This also switches off notifications and the calendar feed on this device. Type "delete" to confirm. It can't be undone.

## When one device is newer

If one of your devices runs a newer version than another, the older one stops editing. It shows your list read-only and asks you to **Reload**. Nothing is lost or overwritten.

**Research says:** not applicable: this is not a method rule.

**Practice says:** keep the key where you keep your passwords. `[E?]`
