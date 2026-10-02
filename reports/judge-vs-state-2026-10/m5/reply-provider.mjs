/** The target of M5: returns the agent's recorded reply, nothing else. */
export default class RecordedReply {
  id() {
    return 'recorded-reply';
  }
  async callApi(_prompt, context) {
    return { output: context.vars.reply };
  }
}
