# Fairbuds 2 protocol

What the page relies on. Everything here was verified against Fairbuds 2 firmware 0.4.1 unless marked otherwise.

## Hardware

Airoha AB1577S. The official app embeds Airoha's SDK and talks **RACE**, Airoha's command protocol. The original Fairbuds
use a different chip (Bestechnic), so nothing from the Fairbuds 1 tooling applies.

## Transport

The buds expose RACE over BLE GATT on a separate LE identity (random static address, no name in the advertisement,
GAP name `Fairbuds 2`):

| | UUID | |
|---|---|---|
| service | `5052494d-2dab-0341-6972-6f6861424c45` | |
| TX | `43484152-2dab-3241-6972-6f6861424c45` | write with response |
| RX | `43484152-2dab-3141-6972-6f6861424c45` | notify |

- Enabling RX notifications needs an encrypted, bonded link. Without one, writes and notifications fail.
  - Android Chrome: the system pairing prompt appears on first connect. One tap.
  - Windows: Web Bluetooth gets `Not paired`. The user pairs "Fairbuds 2" once in Settings → Bluetooth → Add device.
    The audio pairing does not cover this identity.
- MTU is 512. A frame larger than MTU−3 must be split into consecutive writes; an ATT long write is rejected (0xF1).
  The RACE parser reassembles by the length field. `Session` starts with 509-byte chunks and falls back to smaller ones.
- Frames above 1251 bytes are dropped silently.
- The link often drops once right after pairing; a plain retry works.
- Most likely only one central at a time. A second client fails with `Connection attempt failed` until the first
  disconnects.

## RACE framing

```
05 | type | length u16 LE (id + payload) | id u16 LE | payload
```

type `5A` command, `5B` response, `5D` notification. Responses can span several notifications.

| id | payload | reply | use |
|---|---|---|---|
| `0E03` | `00` + coefficient blob | `00` | apply EQ now (RAM only, lost on power cycle) |
| `0A00` | key u16, max length u16 (1000) | len u16 + data | read NVKEY |
| `0A03` | length u16 | `01` | reclaim space before a write |
| `0A01` | key u16 + data | `00` | write NVKEY |
| `09FD` | `00` + key u16 | `00` | sent by the app after writing the EQ key; does not apply it |
| `0D00` | | `05 06` | partner bud reachable (`00 00`: not) |
| `0D01` | `05 06` + inner frame | `00`, then `5D 0D01 05 06 <inner response>` | relay to the partner bud |

`5D 0D00` arrives unsolicited when the partner link changes: `05 06` back, `00 00` lost.

The connected bud forwards `0E03` to its partner by itself. NVKEY writes must be sent to each bud.

## Coefficient blob

```
count u32                        always 4
count × {
  rate u16                       6 = 96 k, 1 = 44.1 k, 2 = 48 k, 5 = 88.2 k
  words u16                      number of u16 that follow
  nbq u16                        biquads in this table
  nbq × { b0, b1/2, b2, a1/2, a2 }
  gain
}
```

Each value is Q1.31 rounded to 24 bits and stored as the high 16 bits LE, then the low 16 bits LE. `b1` and `a1` are
halved. The app normalises every section to b0 = 1 and multiplies the b0 values into the table's gain word.

- **Send all four tables in every update.** Order 96 k, 44.1 k, 48 k, 88.2 k (the app's order).
- **At most 10 biquads per table.** With 11 the agent still acknowledges, but the partner bud drops out and audio breaks
  until it recovers. Fewer than 10 is fine (the built-in presets use 6 or 7).
- The DSP honours b0. Low-pass and band-pass sections keep their b0 inside the section: normalised, their internal gain
  would be 30 dB or more and likely overflow. Only the unnormalised form has been tested.
- 0 dB reference: the app's flat EQ has a first-section b0 of 0.84034 and a gain word of `0x01321700`. Their product is
  `REF_GAIN`; the page's preamp is relative to it. The app's own presets peak at up to +11 dB above it.

## NVKEYs

| key | content |
|---|---|
| `0xE42C` | custom EQ blob (without the `00` prefix), applied at boot |
| `0xE410`–`0xE414` | built-in presets: Default, Balance, Bass boost, Treble boost, Voice |
| `0xE402` | preset group table: count, then per group n + n × (index, key) |
| `0xEF00`, `0xEF10`, `0xEF20` | the app's slider state; the page does not write them |

All built-in presets share a base tuning (high shelf 3.5 kHz +5 dB, bells at 2.2 kHz +4.5, 86 Hz −1.6, 175 Hz −4,
329 Hz −3.2). The app's custom EQ does not include it, so a flat custom EQ is the untuned driver.

## Saving

Same order as the app:

1. `0D00` must return `05 06`; refuse otherwise.
2. `0E03` with the new tables, so the change is audible now.
3. On the partner (relayed), then on the connected bud: `0A03` with the blob length, then `0A01 2C E4 <blob>`.
4. `09FD 00 2C E4` on the partner, then on the connected bud.
5. Read `0xE42C` back from both and compare.

Any EQ change in the Fairbuds app overwrites `0xE42C`. The app keeps showing its own slider state.

## Not known

- What `09FD` does, and what `0xE42A`/`0xE42B` (one-biquad tables referenced by the first two preset groups) are for.
- Why Chromium on Windows never lists the buds' public LE identities, which expose the same service.
- Whether a fresh Windows PC lists the RACE identity by name in Add device.
