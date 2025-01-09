// @ts-check
const {EventEmitter} = require('node:events');
const {Elf, SmartId} = require('xcraft-core-goblin');
const {
  string,
  enumeration,
  option,
  object,
  boolean,
  number,
} = require('xcraft-core-stones');

class Launcher extends EventEmitter {
  #cmd;

  /** @type {*} */ #timeout;
  #timeInterval = 30000;
  #running = false;
  #retries;
  #initialDelay = false;
  #stopped = false;

  constructor(context, goblinName, questName, params, options) {
    super();

    this.#retries = options.retries;
    this.#initialDelay = !!options.initialDelay;

    this.#cmd = async () =>
      await context.quest.cmd(`${goblinName}.${questName}`, params);

    if (this.#initialDelay) {
      this.#timeout = setTimeout(
        async () => await this.#run(),
        this.#timeInterval
      );
    } else {
      setImmediate(async () => await this.#run());
    }
  }

  #timer() {
    if (this.#stopped) {
      return;
    }

    this.#timeout = setTimeout(
      async () => await this.#run(),
      this.#timeInterval
    );
  }

  async #run() {
    if (this.#running || this.#stopped) {
      return;
    }

    try {
      this.#running = true;
      const result = await this.#cmd();
      this.stop();
      this.emit('success', result);
    } catch (ex) {
      let retry = true;
      if (typeof this.#retries === 'number' && this.#retries > 0) {
        --this.#retries;
        retry = this.#retries > 0;
      }

      if (retry) {
        this.#timer();
      }
      this.emit('error', ex);
    } finally {
      this.#running = false;
    }
  }

  stop() {
    this.#stopped = true;
    clearTimeout(this.#timeout);
    this.#timeout = null;
  }
}

class MetaShape {
  status = enumeration('published', 'trashed');
}

class RockShape {
  id = string;
  meta = MetaShape;
  eventScope = string;
  goblinName = string;
  questName = string;
  params = option(object);
  processed = boolean;
  retries = option(number);
}

class RockState extends Elf.Sculpt(RockShape) {}

class RockLogic extends Elf.Archetype {
  static db = 'rock';
  state = new RockState({
    id: undefined,
    meta: {
      status: 'published',
    },
    eventScope: undefined,
    goblinName: undefined,
    questName: undefined,
    params: undefined,
    processed: false,
    retries: undefined,
  });

  create(id) {
    const {state} = this;
    state.id = id;
  }

  upsert(eventScope, goblinName, questName, params, retries) {
    const {state} = this;
    state.eventScope = eventScope;
    state.goblinName = goblinName;
    state.questName = questName;
    state.params = params;
    state.retries = retries;
    state.processed = false;
    state.meta.status = 'published';
  }

  done() {
    const {state} = this;
    state.processed = true;
  }

  trash() {
    const {state} = this;
    state.meta.status = 'trashed';
  }
}

class Rock extends Elf {
  logic = Elf.getLogic(RockLogic);
  state = new RockState();

  _launcher;
  _processing = false;

  /**
   * @param {*} id rock@<baseId>
   * @param {*} desktopId desktop id
   * @returns {Promise<this>} this
   */
  async create(id, desktopId) {
    this.logic.create(id);
    await this.persist();
    return this;
  }

  async upsert(eventScope, goblinName, questName, params, retries) {
    if (this._processing) {
      this.log.warn(
        `${this.id} is already processing, skip upsert for ${eventScope}`
      );
      return false;
    }

    this.logic.upsert(eventScope, goblinName, questName, params, retries);
    await this.persist();
    return true;
  }

  async process(initialDelay = false) {
    const {state} = this;
    const {
      id,
      eventScope,
      goblinName,
      questName,
      params,
      processed,
      retries,
    } = state;

    if (this._processing) {
      this.log.warn(
        `${this.id} is already processing, skip second process call for ${eventScope}`
      );
      return;
    }
    this._processing = true;

    if (processed) {
      this.log.warn(
        `${id} is already ${processed ? 'processed' : 'processing'}`
      );
      return;
    }

    if (this._launcher) {
      this._launcher.stop();
    }

    const baseId = SmartId.toExternalId(id);

    this._launcher = new Launcher(
      this,
      goblinName,
      questName,
      params ? params.toJS() : null,
      {retries, initialDelay}
    );
    this._launcher
      .on('success', async (result) => {
        try {
          await this.done();
          this.quest.evt(`<${eventScope}-rock-processed>`, {baseId, result});
        } catch (ex) {
          this.log.err(ex.stack || ex.message || ex);
        }
      })
      .on('error', (error) => {
        const sent = this.quest.evt(`<${eventScope}-rock-processed>`, {
          baseId,
          error,
        });
        if (!sent) {
          this.log.warn(
            `rock ${baseId} cannot be processed: ${
              error.stack || error.message || error
            }`
          );
        }
      });
  }

  async done() {
    this.logic.done();
    await this.persist();
    this.quest.evt('<kill-the-rock>', {id: this.id});
  }

  async trash() {
    if (this._launcher) {
      this._launcher.stop();
    }
    this.logic.trash();
    await this.persist();

    this._launcher = null;
    this.quest.evt('<kill-the-rock>', {id: this.id});
  }

  delete() {
    if (this._launcher) {
      this._launcher.stop();
    }
  }

  dispose() {
    if (this._launcher) {
      this._launcher.stop();
    }
  }
}

module.exports = {Rock, RockShape, RockLogic};
