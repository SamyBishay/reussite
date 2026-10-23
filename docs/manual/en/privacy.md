# Privacy

Your data stays on your devices. This page says what leaves them, when you choose to let it.

![The privacy note in Settings → About](shot:privacy)

## By default: nothing leaves

With no sync, no AI and no connector, everything stays on your device. There are no accounts, no tracking, and no third-party requests when the app runs.

## With sync

Your list is scrambled on your device first. **What the relay can see:**

- your list as scrambled blobs, their sizes and when they arrive;
- IP addresses;
- the push address of each device, and the times its notifications are due (their text is scrambled, so the relay can't read it);
- the calendar feed, only if you switch it on, with generic titles unless you include step titles;
- your whole list, **while the connector is on**.

It never sees what is inside a scrambled blob.

## With an AI

**What an AI provider sees:** exactly what each request sends. You can read it first with "Show me what's sent". Memory notes that match your request go with it, unless you marked them Private. People you saved are included only if you tick them.

Your API key stays on this device. It is never synced and never in a backup.

## Things that are never sent

- **Private notes** in Memory: never sent to an AI, not even through the connector.
- **How to reach a person:** never in a trip pack.
- **Diagnostics:** never include your steps, notes, names, places or keys.

## Forget and delete

- **Forget** a memory note, and the words are gone, including from History and your synced copy.
- **Delete everywhere** removes your synced copy from the relay.
- Whatever the connector or an AI has already read can't be un-read.

## If you lose everything

If you lose every device and the recovery key, the list is gone for good. See [Sync and recovering a lost device](sync-and-recovery.md).
