import streamDeck from '@elgato/streamdeck';

export async function sendToPi(payload: Record<string, unknown>) {
  try {
    await streamDeck.ui.sendToPropertyInspector(payload as never);
  } catch {
    /* Inspector may have closed. */
  }
}
