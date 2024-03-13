// @ts-check
const {Elf, SmartId} = require('xcraft-core-goblin');
const {string} = require('xcraft-core-stones');
const {Rock, RockLogic} = require('./rock.js');

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
    const ids = Array.from(
      await this.cryo.queryLastActions(RockLogic.db, 'rock', ['id'])
    ).map(({id}) => id);

    for (const id of ids) {
      const rock = await new Rock(this).create(id, this._desktopId);
      await rock.process();
    }
  }

  /**
   * Begin a new web call (hurl a rock) with retry strategy.
   *
   * @param {*} baseId
   * @param {*} eventScope
   * @param {*} goblinName
   * @param {*} questName
   * @param {*} params
   */
  async hurl(baseId, eventScope, goblinName, questName, params) {
    const id = SmartId.from('rock', baseId);
    const rock = await new Rock(this).create(id, this._desktopId);
    await rock.upsert(eventScope, goblinName, questName, params);
    await rock.process();
  }

  async break(baseId) {
    const id = SmartId.from('rock', baseId);
    const rock = await new Rock(this).create(id, this._desktopId);
    await rock.trash();
  }
}

module.exports = {Blackrock, BlackrockLogic};
