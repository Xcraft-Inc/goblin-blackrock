# 📘 Documentation du module goblin-blackrock

## Aperçu

Le module `goblin-blackrock` est un système robuste de gestion d'appels asynchrones avec stratégie de réessai automatique dans l'écosystème Xcraft. Il permet d'exécuter des tâches (quêtes) de manière fiable, même en cas d'échec temporaire, en réessayant automatiquement selon une stratégie configurable. Ce module est particulièrement utile pour les opérations qui nécessitent une garantie d'exécution dans un environnement distribué ou sujet à des défaillances.

## Sommaire

- [Structure du module](#structure-du-module)
- [Fonctionnement global](#fonctionnement-global)
- [Exemples d'utilisation](#exemples-dutilisation)
- [Interactions avec d'autres modules](#interactions-avec-dautres-modules)
- [Détails des sources](#détails-des-sources)

## Structure du module

Le module est composé de deux acteurs principaux implémentés selon le modèle Elf du framework Xcraft :

1. **Blackrock** - Un acteur singleton (`Elf.Alone`) qui gère l'orchestration globale des appels asynchrones
2. **Rock** - Un acteur instanciable (`Elf`) qui représente un appel spécifique à exécuter avec sa stratégie de réessai

Ces acteurs suivent une architecture claire avec séparation entre la logique métier (classes `BlackrockLogic` et `RockLogic`) et l'état (classes `BlackrockState` et `RockState`).

## Fonctionnement global

Le système fonctionne sur le principe de "lancer des roches" (hurl rocks) qui représentent des appels à des quêtes spécifiques :

1. **Initialisation** : Au démarrage, `Blackrock` récupère tous les rocks non traités depuis la base de données et relance leur traitement automatiquement
2. **Création d'appels** : Lorsqu'un appel doit être effectué avec une stratégie de réessai, `Blackrock` crée un nouvel acteur `Rock`
3. **Encapsulation** : Le `Rock` encapsule les détails de l'appel (goblin cible, nom de la quête, paramètres) et sa stratégie de réessai
4. **Exécution** : Un `Launcher` interne (implémenté comme une classe `EventEmitter`) gère l'exécution de l'appel et les tentatives de réessai en cas d'échec
5. **Notification** : Les événements de succès ou d'échec sont émis pour permettre aux consommateurs de réagir en conséquence
6. **Persistance** : Les `Rock` sont persistés dans une base de données (via `Elf.Archetype`), ce qui permet de reprendre les appels non traités après un redémarrage

Le module utilise un système d'événements pour notifier les consommateurs du résultat des appels, qu'ils soient réussis ou échoués, en émettant des événements dans le format `<eventScope-rock-processed>`.

## Exemples d'utilisation

### Lancer un appel avec réessai automatique

```javascript
// Dans une méthode d'un acteur Elf
async hurlSomething() {
  // Obtenir une référence à l'acteur Blackrock
  const blackrock = new Blackrock(this);

  // Écouter le résultat
  this.quest.sub(`<myEventScope-rock-processed>`, (err, {msg}) => {
    const {baseId, result, error} = msg.data;
    if (error) {
      // Gérer l'erreur après épuisement des tentatives
      console.error(`Operation ${baseId} failed:`, error);
    } else {
      // Traiter le résultat en cas de succès
      console.log(`Operation ${baseId} succeeded:`, result);
    }
  });

  // Lancer un appel avec réessai
  await blackrock.hurl(
    'my-operation-id',           // ID de base pour cette opération
    'myEventScope',              // Portée d'événement pour les notifications
    'myGoblin',                  // Nom du goblin cible
    'doSomething',               // Nom de la quête à exécuter
    {param1: 'value1'},          // Paramètres de la quête
    5                            // Nombre de tentatives (undefined pour infini)
  );
}
```

### Annuler un appel en cours

```javascript
// Dans une méthode d'un acteur Elf
async breakSomething() {
  // Obtenir une référence à l'acteur Blackrock
  const blackrock = new Blackrock(this);

  // Annuler un appel en cours
  await blackrock.break('my-operation-id');
}
```

### Appel avec délai initial

```javascript
// Lancer un appel avec un délai de 30 secondes avant la première tentative
const rock = await new Rock(this).create('delayed-operation', desktopId);
await rock.upsert('myScope', 'myGoblin', 'delayedQuest', {data: 'test'}, 3);
await rock.process(true); // true pour activer le délai initial
```

## Interactions avec d'autres modules

- **[xcraft-core-goblin]** : Utilise le framework Elf pour la définition des acteurs et la gestion de l'état
- **[xcraft-core-stones]** : Utilise les types de données pour définir les formes (shapes) des états
- **[xcraft-core-utils]** : Dépendance pour les utilitaires de base du framework Xcraft
- **Système d'événements Xcraft** : Utilise les événements pour notifier les consommateurs des résultats
- **Système de persistance Cryo** : Utilise la persistance pour stocker et récupérer les rocks non traités

Le module s'intègre dans l'écosystème Xcraft en fournissant une abstraction pour les appels asynchrones fiables, utilisable par n'importe quel autre service ou goblin.

## Détails des sources

### `blackrock.js`

Ce fichier expose les commandes Xcraft pour l'acteur `Blackrock` via `Elf.birth()`, permettant au système de charger automatiquement l'acteur sur le bus Xcraft.

### `rock.js`

Ce fichier expose les commandes Xcraft pour l'acteur `Rock` via `Elf.birth()`, permettant au système de charger automatiquement l'acteur sur le bus Xcraft.

### `lib/blackrock.js`

Ce fichier définit l'acteur `Blackrock` et sa logique associée `BlackrockLogic`. En tant que singleton (`Elf.Alone`), il est responsable de l'orchestration des appels asynchrones avec réessai.

#### État et modèle de données

```javascript
class BlackrockShape {
  id = string;
}
```

L'état de Blackrock est minimal, ne contenant qu'un identifiant fixe : `'blackrock'`.

#### Méthodes publiques

- **`init()`** — Méthode d'initialisation appelée au démarrage qui récupère tous les rocks non traités depuis la base de données et relance leur traitement automatiquement. Configure également la souscription aux événements `<kill-the-rock>` pour nettoyer les ressources.
- **`hurl(baseId, eventScope, goblinName, questName, params, retries)`** — Lance un nouvel appel asynchrone avec stratégie de réessai. Crée un acteur Rock avec l'ID spécifié, configure ses paramètres et démarre son traitement.
- **`break(baseId)`** — Annule un appel en cours en récupérant le Rock correspondant et en appelant sa méthode `trash()`. L'opération de suppression est différée pour éviter les conflits de concurrence.

### `lib/rock.js`

Ce fichier contient la logique principale du système avec l'acteur `Rock`, sa logique `RockLogic` et la classe utilitaire `Launcher`. Il implémente la persistance via `Elf.Archetype` avec la base de données 'rock'.

#### État et modèle de données

```javascript
class RockShape {
  id = string; // Identifiant unique du rock
  meta = MetaShape; // Métadonnées avec statut
  eventScope = string; // Portée d'événement pour les notifications
  goblinName = string; // Nom du goblin cible
  questName = string; // Nom de la quête à exécuter
  params = option(object); // Paramètres de la quête (optionnel)
  processed = boolean; // Indique si le rock a été traité
  retries = option(number); // Nombre de tentatives restantes
  error = option(string); // Dernière erreur rencontrée (optionnel)
}

class MetaShape {
  status = enumeration('published', 'trashed');
}
```

#### Méthodes publiques

- **`create(id, desktopId)`** — Crée un nouveau Rock avec l'ID spécifié et le persiste immédiatement. Retourne l'instance pour permettre le chaînage des méthodes.
- **`upsert(eventScope, goblinName, questName, params, retries)`** — Met à jour les paramètres d'un Rock existant si celui-ci n'est pas déjà en cours de traitement. Retourne `true` si la mise à jour a été effectuée, `false` sinon.
- **`process(initialDelay = false)`** — Démarre l'exécution de l'appel avec la stratégie de réessai. Crée un `Launcher` qui gère les tentatives et écoute les événements de succès/échec. Le paramètre `initialDelay` permet d'attendre 30 secondes avant la première tentative.
- **`done()`** — Marque un Rock comme traité avec succès, supprime l'erreur éventuelle et émet un événement `<kill-the-rock>` pour déclencher la suppression de l'acteur.
- **`setError(error)`** — Enregistre une erreur survenue lors de l'exécution et persiste l'état mis à jour.
- **`trash()`** — Marque un Rock comme supprimé, arrête le launcher et émet un événement `<kill-the-rock>` pour déclencher la suppression de l'acteur.
- **`delete()`** et **`dispose()`** — Nettoient les ressources en arrêtant le launcher pour éviter les fuites mémoire.

#### Classe Launcher

La classe `Launcher` est un composant clé qui étend `EventEmitter` et gère l'exécution des appels avec la stratégie de réessai :

**Caractéristiques :**

- **Intervalle de réessai** : 30 secondes entre chaque tentative
- **Gestion des tentatives** : Décrémente le compteur de `retries` à chaque échec (si défini)
- **Délai initial** : Optionnel, permet d'attendre avant la première exécution
- **Événements** : Émet 'success' avec le résultat ou 'error' avec l'erreur
- **Arrêt automatique** : S'arrête en cas de succès ou d'épuisement des tentatives

**Méthodes :**

- **`constructor(context, goblinName, questName, params, options)`** — Initialise le launcher avec les paramètres d'appel et démarre l'exécution
- **`stop()`** — Arrête le launcher et nettoie les timers

Cette implémentation garantit que les appels sont exécutés de manière fiable, même en cas de défaillances temporaires du système, avec une stratégie de réessai configurable et une gestion propre des ressources.

---

_Cette documentation a été mise à jour automatiquement._

[xcraft-core-goblin]: https://github.com/Xcraft-Inc/xcraft-core-goblin
[xcraft-core-stones]: https://github.com/Xcraft-Inc/xcraft-core-stones
[xcraft-core-utils]: https://github.com/Xcraft-Inc/xcraft-core-utils