// @ts-check
const {EventEmitter} = require('node:events');
const {Elf, SmartId} = require('xcraft-core-goblin');
const {string, enumeration, option, object} = require('xcraft-core-stones');

class Launcher extends EventEmitter {
  #cmd;
  #scope;

  /** @type {*} */ #timeout;
  #timeInterval = 30000;
  #running = false;

  constructor(context, goblinName, questName, params) {
    super();

    this.#cmd = async () =>
      await context.quest.cmd(`${goblinName}.${questName}`, params);

    setImmediate(async () => await this.#run());
    this.#timer();
  }

  #timer() {
    this.#timeout = setTimeout(
      async () => await this.#run(),
      this.#timeInterval
    );
  }

  async #run() {
    if (this.#running) {
      return;
    }

    try {
      this.#running = true;
      const result = await this.#cmd();
      this.stop();
      this.emit('success', result);
    } catch (ex) {
      const error = ex.stack || ex.message || ex;
      this.#timer();
      this.emit('error', error);
    } finally {
      this.#running = false;
    }
  }

  stop() {
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
}

class RockState extends Elf.Sculpt(RockShape) {}

class RockLogic extends Elf.Archetype {
  static db = 'chronomancer';
  state = new RockState({
    id: undefined,
    meta: {
      status: 'published',
    },
    eventScope: undefined,
    goblinName: undefined,
    questName: undefined,
    params: undefined,
  });

  create(id) {
    const {state} = this;
    state.id = id;
  }

  upsert(eventScope, goblinName, questName, params) {
    const {state} = this;
    state.eventScope = eventScope;
    state.goblinName = goblinName;
    state.questName = questName;
    state.params = params;
  }

  trash() {
    this.state.meta.status = 'trashed';
  }
}

class Rock extends Elf {
  logic = Elf.getLogic(RockLogic);
  state = new RockState();

  _launcher;

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

  async upsert(eventScope, goblinName, questName, params) {
    this.logic.upsert(eventScope, goblinName, questName, params);
    await this.persist();
  }

  async process() {
    const {state} = this;
    const {id, eventScope, goblinName, questName, params} = state;

    const baseId = SmartId.toExternalId(id);

    this._launcher = new Launcher(this, goblinName, questName, params);
    this._launcher
      .on('success', (result) =>
        this.quest.evt(`<${eventScope}-rock-processed>`, {baseId, result})
      )
      .on('error', (error) =>
        this.quest.evt(`<${eventScope}-rock-processed>`, {baseId, error})
      );
  }

  async trash() {
    if (this._launcher) {
      this._launcher.stop();
    }
    this.logic.trash();
    await this.persist();

    this._launcher = null;
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

module.exports = {Rock, RockLogic};
