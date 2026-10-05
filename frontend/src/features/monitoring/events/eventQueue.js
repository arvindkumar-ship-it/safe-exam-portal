// FIFO queue. Event sirf server ack ke baad hatta hai (R6).
export class EventQueue {
  constructor(store) {
    this.store = store;
    this.items = [];
    this.seen = new Set();
  }

  async init() {
    const all = await this.store.all();
    all.sort((a, b) => a.clientSequence - b.clientSequence);
    this.items = all;
    this.seen = new Set(all.map((e) => e.clientSequence));
  }

  async add(event) {
    if (this.seen.has(event.clientSequence)) return false; // duplicate ignore
    this.seen.add(event.clientSequence);
    this.items.push(event);
    if (this.items.length > 1 && this.items[this.items.length - 2].clientSequence > event.clientSequence) {
      this.items.sort((a, b) => a.clientSequence - b.clientSequence);
    }
    try { await this.store.put(event); } catch { /* memory me rehta hai, persistence best-effort */ }
    return true;
  }

  async getBatch(limit = 20) { return this.items.slice(0, limit); }

  async removeUpTo(sequence) {
    this.items = this.items.filter((e) => e.clientSequence > sequence);
    this.seen = new Set(this.items.map((e) => e.clientSequence));
    await this.store.removeUpTo(sequence);
  }

  // Extra: permanently rejected events individually hatane ke liye.
  async removeSequences(list) {
    const drop = new Set(list);
    this.items = this.items.filter((e) => !drop.has(e.clientSequence));
    this.seen = new Set(this.items.map((e) => e.clientSequence));
    await this.store.removeSequences(list);
  }

  size() { return this.items.length; }
}
