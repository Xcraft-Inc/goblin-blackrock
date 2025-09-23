// @ts-check
const {Elf, SmartId} = require('xcraft-core-goblin');
const {string} = require('xcraft-core-stones');
const {Rock, RockLogic, RockShape} = require('./rock.js');

class BlackrockShape {
  id = string;
}

class BlackrockState extends Elf.Sculpt(BlackrockShape) {}

class BlackrockLogic extends Elf.Spirit {
  state = new BlackrockState({
    id: 'blackrock',
  });
}

class Blackrock extends Elf.Alone {
  _desktopId = 'system@blackrock';

  async init() {
    const reader = await this.cryo.reader(RockLogic.db);
    const ids = reader
      .queryArchetype('rock', RockShape)
      .field('id')
      .where((rock, $) =>
        $.and(rock.get('processed').eq(false), rock.get('retries').neq(0))
      )
      .iterate();

    this.quest.sub(`*::*.<kill-the-rock>`, async (_, {msg}) => {
      const {id} = msg.data;
      await this.kill(id, this.id, this._desktopId);
    });

    if (process.env.NODE_ENV === 'development') {
      this.log.dbg('Disable rock auto-process in development mode');
      return;
    }

    for (const id of ids) {
      const rock = await new Rock(this).create(id, this._desktopId);
      await rock.process();
    }
  }

  /**
   * Begin a new call (hurl a rock) with retry strategy.
   * @param {*} baseId
   * @param {*} eventScope
   * @param {*} goblinName
   * @param {*} questName
   * @param {*} params
   * @param {*} [retries] null or undefined if infinite
   */
  async hurl(baseId, eventScope, goblinName, questName, params, retries) {
    const id = SmartId.from('rock', baseId);
    const rock = await new Rock(this).create(id, this._desktopId);
    await rock.upsert(eventScope, goblinName, questName, params, retries);
    await rock.process();
  }

  async break(baseId) {
    const id = SmartId.from('rock', baseId);
    const rock = await new Rock(this).create(id, this._desktopId);
    this.quest.defer(async () => await this.kill(id, this.id, this._desktopId));
    await rock.trash();
  }
}

module.exports = {Blackrock, BlackrockLogic};
