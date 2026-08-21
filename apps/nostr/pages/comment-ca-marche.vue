<template>
  <div ref="scroller" class="doc">
    <div class="doc__wrap">
      <header class="hero panel">
        <p class="hero__eyebrow mono">comment ça marche</p>
        <h1 class="hero__title display">
          Tu lis en deux secondes, tu postes sans compte, et rien ne peut être retiré du réseau.
        </h1>
        <p class="hero__lead">
          Ces trois phrases sont des choix techniques, pas des slogans. Cette page les démonte dans
          l’ordre : ce qu’est ce forum, ce qu’est un message, où il va — et ce que le système ne
          saura jamais faire.
        </p>
      </header>

      <div class="doc__body">
        <nav class="rail" aria-label="Sommaire">
          <p class="rail__head">Sommaire</p>
          <template v-for="part in PARTS" :key="part.label ?? 'preambule'">
            <p v-if="part.label" class="rail__part mono">{{ part.label }}</p>
            <ul class="rail__list">
              <li v-for="ch in part.items" :key="ch.id">
                <a
                  class="rail__link"
                  :class="{ 'rail__link--on': active === ch.id }"
                  :href="`#${ch.id}`"
                  :aria-current="active === ch.id ? 'true' : undefined"
                  @click.prevent="goTo(ch.id)"
                  >{{ ch.short }}</a
                >
              </li>
            </ul>
          </template>
        </nav>

        <article class="sheet panel">
          <!-- ================================================== LE PROJET
               Le produit avant la mécanique : sans ça, la page s'ouvre sur un
               objet signé alors que le lecteur ne sait pas encore de quoi on
               parle. -->
          <section id="projet" class="ch ch--first" data-ch>
            <p class="ch__eyebrow mono">forome</p>
            <h2 class="ch__title display">Ce que c’est</h2>
            <p class="ch__lead">
              Un forum généraliste où l’on parle vite et beaucoup. Tu arrives, tu vois ce qui chauffe,
              tu réponds — et tu n’as rien créé pour ça, ni compte, ni mot de passe, ni adresse
              e-mail.
            </p>
            <p>
              Ce que tu fais en arrivant : la page s’ouvre, la liste des topics est classée par
              activité du moment, tu en choisis un et il s’ouvre à côté. Tu écris, ça part. Pendant ce temps, sans rien te demander, ton navigateur a fabriqué une identité
              — un pseudo provisoire du genre <span class="mono">khey_a3f81b2c</span>, que tu peux
              garder des années ou jeter en un clic.
            </p>
            <p>
              Ce qui change vraiment n’est pas l’écran, c’est ce qu’il y a derrière : le forum ne
              tourne pas sur un serveur qui nous appartiendrait. Tes messages sont recopiés sur
              plusieurs machines indépendantes appelées <strong>relais</strong>, et chacune n’en
              détient qu’une copie parmi d’autres.
            </p>

            <table class="tbl tbl--cmp">
              <thead>
                <tr>
                  <th>Un forum ordinaire</th>
                  <th>Ici</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Tu crées un compte chez l’hébergeur.</td>
                  <td>Ton navigateur fabrique une clé, et cette clé <em>est</em> ton compte.</td>
                </tr>
                <tr>
                  <td>L’hébergeur détient les messages.</td>
                  <td>Plusieurs relais en gardent chacun une copie.</td>
                </tr>
                <tr>
                  <td>Un modérateur supprime un message.</td>
                  <td>Un relais peut cesser de le servir ; il existe toujours ailleurs.</td>
                </tr>
                <tr>
                  <td>Si le site ferme, tout disparaît.</td>
                  <td>Un relais peut fermer sans que le forum soit dedans.</td>
                </tr>
                <tr>
                  <td>Tu modifies ou supprimes ce que tu as écrit.</td>
                  <td>Tu ne peux pas. Rien ne se retire, y compris par toi.</td>
                </tr>
              </tbody>
            </table>

            <p>
              Cette dernière ligne est le vrai prix à payer, et elle vaut d’être lue avant de poster :
              publier ici est <strong>définitif</strong>. En échange, personne ne peut faire
              disparaître ce que tu as écrit — ni par erreur, ni sous pression.
            </p>
            <p>
              Rien de tout ça n’a été inventé ici : le forum est bâti sur <strong>Nostr</strong>, un
              protocole ouvert. C’est le chapitre suivant, et c’est celui qui explique tous les
              autres.
            </p>
            <p class="ch__howto">
              Pour la suite : chaque chapitre s’ouvre sur une phrase en gros caractères. Lues
              d’affilée, elles font la version courte. Le reste creuse, et « le détail » se déplie
              pour qui veut aller au fond.
            </p>
          </section>

          <section id="nostr" class="ch" data-ch>
            <p class="ch__eyebrow mono">NIP-01</p>
            <h2 class="ch__title display">Nostr, le protocole en dessous</h2>
            <p class="ch__lead">
              Nostr n’est ni un site, ni une entreprise, ni un réseau qu’on rejoint. C’est un accord :
              un format de message, et une façon de le transmettre.
            </p>
            <p>
              Le meilleur point de comparaison est l’e-mail. Personne ne « possède » l’e-mail :
              il existe un format d’adresse, un format de message, et des milliers de serveurs qui
              ont accepté les mêmes règles. On peut écrire un nouveau logiciel de courrier demain
              sans demander la permission à quiconque. Nostr joue ce rôle pour des messages
              <strong>publics et signés</strong>.
            </p>
            <p>Tout le protocole tient dans deux rôles, et il n’y en a pas de troisième :</p>

            <div class="roles">
              <div class="roles__one">
                <p class="roles__t">Les clients</p>
                <p class="roles__d">
                  Des applications. Elles fabriquent les messages, les signent, les envoient, les
                  relisent et les affichent. Ce forum est un client — il n’a aucun privilège sur les
                  autres.
                </p>
              </div>
              <div class="roles__one">
                <p class="roles__t">Les relais</p>
                <p class="roles__d">
                  Des machines qui reçoivent, gardent et redonnent. Elles n’interprètent rien, et
                  n’ont pas besoin de se connaître entre elles. N’importe qui peut en faire tourner
                  une.
                </p>
              </div>
            </div>

            <p>
              Pas de compte central, pas d’annuaire, pas d’autorité qui distribue les identités.
              Ton identité, c’est ta clé — et elle n’a été enregistrée nulle part, ce qui est
              précisément pourquoi personne ne peut te la retirer.
            </p>
            <p>
              Ce que le protocole <strong>fixe</strong> : la forme d’une identité, la forme d’un
              message, et le dialogue avec un relais. Ce qu’il ne fixe <strong>pas</strong> : à quoi
              ressemble un forum, comment on classe une liste de topics, ce qui est de trop, comment
              on modère. Tout ce qui fait Forome vit dans cet espace laissé libre — le protocole ne
              donne pas un produit, il donne un socle.
            </p>
            <p>
              Ce socle s’étend par des documents numérotés, les <strong>NIP</strong>. Chacun décrit
              une brique, et un logiciel implémente celles dont il a besoin. Ce forum en utilise une
              douzaine :
            </p>

            <table class="tbl">
              <tbody>
                <tr><td class="tbl__k mono">NIP-01</td><td>la base : les clés, l’objet signé, le dialogue avec un relais</td></tr>
                <tr><td class="tbl__k mono">NIP-19</td><td>les formes lisibles <span class="mono">npub1…</span> et <span class="mono">nsec1…</span></td></tr>
                <tr><td class="tbl__k mono">NIP-7D</td><td>les topics</td></tr>
                <tr><td class="tbl__k mono">NIP-22</td><td>les réponses dans un fil</td></tr>
                <tr><td class="tbl__k mono">NIP-13</td><td>la preuve de travail</td></tr>
                <tr><td class="tbl__k mono">NIP-17</td><td>les messages privés, avec NIP-44 et NIP-59</td></tr>
                <tr><td class="tbl__k mono">NIP-05</td><td>rattacher son nom à un domaine qu’on possède</td></tr>
                <tr><td class="tbl__k mono">NIP-07</td><td>signer avec une extension de navigateur</td></tr>
                <tr><td class="tbl__k mono">NIP-46</td><td>signer à distance, sans que le site voie la clé</td></tr>
                <tr><td class="tbl__k mono">NIP-51</td><td>les listes : masquer, suivre</td></tr>
                <tr><td class="tbl__k mono">NIP-56</td><td>les signalements</td></tr>
                <tr><td class="tbl__k mono">NIP-78</td><td>le classement des topics, publié comme un objet</td></tr>
              </tbody>
            </table>

            <p>
              Ce que ça te donne, très concrètement : ta clé n’est pas « un compte Forome ». Elle
              fonctionne dans d’autres applications Nostr, où tes messages sont déjà visibles. Si ce
              forum fermait demain, ton identité et ce que tu as écrit continueraient d’exister
              ailleurs. Et l’envers de la même pièce : ce que tu publies ici peut apparaître dans un
              autre logiciel, présenté autrement, sans que tu aies un mot à dire.
            </p>
            <p>
              Enfin, ce que Nostr ne promet pas — et qu’aucun client ne peut rattraper : ni qu’un
              relais restera en vie, ni un ordre exact des messages, ni l’unicité des pseudos, ni la
              suppression de quoi que ce soit. C’est le dernier chapitre de cette page.
            </p>

            <details class="det">
              <summary class="det__sum">Le détail</summary>
              <div class="det__body">
                <p>
                  Le dialogue est du JSON sur une WebSocket, et il se lit à l’œil nu. Le nom est un
                  acronyme : <em>Notes and Other Stuff Transmitted by Relays</em>.
                </p>
                <p>
                  Les relais ne se répliquent pas entre eux par défaut : c’est le client qui parle à
                  plusieurs, et c’est lui qui fusionne. Deux relais peuvent donc détenir des morceaux
                  différents de la même conversation, et aucun des deux n’a tort.
                </p>
              </div>
            </details>
          </section>

          <!-- ================================================ I · L'OBJET -->
          <p class="part mono">I · L’objet que tu envoies</p>

          <!-- La démonstration ouvre la partie qu'elle résume : ses sept champs
               sont les six chapitres qui suivent. -->
          <SignedEventDemo class="sheet__demo" @goto="goTo" />
          <p class="sheet__map">Sept champs. Chacun renvoie au chapitre qui l’explique.</p>

          <section id="cle" class="ch" data-ch>
            <p class="ch__eyebrow mono">"pubkey"</p>
            <h2 class="ch__title display">Ta clé est ton compte</h2>
            <p class="ch__lead">
              Tu n’as pas de compte. Tu as deux nombres liés entre eux, fabriqués dans ton
              navigateur à ta première visite, sans que rien ne te soit demandé.
            </p>
            <p>
              Le premier est <strong>secret</strong> : il ne sort pas de ton appareil. Le second est
              <strong>public</strong> : il est ton identité, et tout le monde le voit. Le public se
              calcule à partir du secret en une fraction de milliseconde. Dans l’autre sens,
              personne ne sait le faire — et c’est là-dessus que tient l’ensemble du système.
            </p>

            <SchemaKeys class="ch__fig" />

            <p>
              Ta clé publique est ton vrai nom ici. Le pseudo affiché n’est qu’une étiquette que tu
              publies à côté, et <strong>il n’est pas unique</strong> : deux personnes peuvent
              choisir le même. C’est pour ça que chaque pseudo traîne derrière lui un petit suffixe
              en mono — les premiers caractères de la clé, qui, eux, ne s’imitent pas.
            </p>
            <p>La clé peut vivre à trois endroits, et le choix n’est pas cosmétique :</p>
            <ul>
              <li>
                <strong>dans ce navigateur</strong> — le défaut. Simple, et fragile : vider les
                données du site l’efface.
              </li>
              <li>
                <strong>dans une extension</strong> — elle signe à ta place, ce site ne voit jamais
                la clé.
              </li>
              <li>
                <strong>dans un signeur distant</strong> — la clé reste ailleurs et n’accorde à ce
                client qu’une autorisation, <strong>révocable</strong>. C’est la seule des trois
                options qui survit à un appareil perdu.
              </li>
            </ul>
            <p>
              Conséquence dure, à lire deux fois : il n’y a pas de mot de passe, donc pas de « mot
              de passe oublié ». Personne — ni nous, ni un relais — ne peut te rendre une clé
              perdue. Et personne ne peut te la retirer non plus.
            </p>

            <details class="det">
              <summary class="det__sum">Le détail</summary>
              <div class="det__body">
                <p>
                  La courbe est secp256k1, les signatures suivent BIP-340 (schnorr). Les formes
                  <code>nsec1…</code> et <code>npub1…</code> sont des encodages lisibles (NIP-19)
                  des mêmes nombres ; le protocole, lui, travaille en hexadécimal — c’est la forme
                  que tu vois dans l’objet en haut de page.
                </p>
                <p>
                  Nostr n’a ni rotation ni révocation de clé : aucun standard adopté ne dit « cette
                  clé remplace celle-là ». Le signeur distant (NIP-46) est le seul remède réel, et
                  c’est pour cette raison qu’il existe ici.
                </p>
              </div>
            </details>
          </section>

          <section id="genre" class="ch" data-ch>
            <p class="ch__eyebrow mono">"kind" · "content"</p>
            <h2 class="ch__title display">Le genre, et le texte</h2>
            <p class="ch__lead">
              Chaque objet porte un numéro qui dit ce qu’il est : un topic, une réponse, un profil,
              une liste. Le texte, lui, voyage en clair.
            </p>
            <p>
              Ce numéro — le <em>kind</em> — n’est pas une étiquette interne : c’est ce qui permet à
              des logiciels qui ne se connaissent pas de savoir quoi faire d’un objet. Un autre
              client Nostr peut lire tes messages sans rien savoir de ce forum, parce qu’il
              reconnaît les genres.
            </p>

            <table class="tbl">
              <tbody>
                <tr><td class="tbl__k mono">0</td><td>ton profil : pseudo, avatar, à propos</td></tr>
                <tr><td class="tbl__k mono">3</td><td>la liste des clés que tu suis</td></tr>
                <tr><td class="tbl__k mono">11</td><td>un topic</td></tr>
                <tr><td class="tbl__k mono">1111</td><td>une réponse dans un topic</td></tr>
                <tr><td class="tbl__k mono">1059</td><td>un message privé, emballé</td></tr>
                <tr><td class="tbl__k mono">1984</td><td>un signalement</td></tr>
                <tr><td class="tbl__k mono">10000</td><td>la liste des clés que tu masques</td></tr>
                <tr><td class="tbl__k mono">30078</td><td>le classement de la liste des topics</td></tr>
              </tbody>
            </table>

            <p>
              Le contenu public <strong>n’est pas chiffré</strong>, et c’est volontaire : chiffrer un
              message destiné à tout le monde ne cache rien à personne. Les seuls messages chiffrés
              ici sont les messages privés, et ils ont leur propre mécanique
              (<a href="#prive" @click.prevent="goTo('prive')">plus bas</a>).
            </p>

            <details class="det">
              <summary class="det__sum">Le détail</summary>
              <div class="det__body">
                <p>
                  Les plages de kinds ont un sens : au-dessus de 10000, un objet est
                  <strong>remplaçable</strong> — le dernier publié par une clé écrase le précédent,
                  ce qui est exactement ce qu’il faut pour un profil ou une liste. Entre 20000 et
                  29999, il est <strong>éphémère</strong> : les relais le transmettent sans le
                  stocker.
                </p>
                <p>
                  Un topic est un kind 11 (NIP-7D) et une réponse un kind 1111 (NIP-22), plutôt
                  qu’une note ordinaire : un forum a besoin qu’un fil soit un objet et non une
                  convention d’affichage. Un message est plafonné à 32 ko de texte.
                </p>
              </div>
            </details>
          </section>

          <section id="heure" class="ch" data-ch>
            <p class="ch__eyebrow mono">"created_at"</p>
            <h2 class="ch__title display">L’heure est une déclaration</h2>
            <p class="ch__lead">
              L’heure d’un message est écrite par son auteur. Rien ne l’oblige à être vraie, et
              aucune horloge ne fait autorité.
            </p>
            <p>
              Il n’y a pas de serveur pour tamponner l’arrivée d’un message, donc pas d’ordre
              officiel. Ce qu’un relais peut faire, c’est refuser l’invraisemblable : ici, plus de
              deux minutes dans le futur ou plus d’une heure dans le passé. C’est une borne, pas
              une vérification — dans cette fenêtre, l’auteur écrit ce qu’il veut.
            </p>
            <p>
              Ce que ça coûte : deux messages envoyés à la même seconde peuvent apparaître dans un
              ordre différent chez deux personnes. C’est pour cette raison que le numéro affiché à
              côté d’un post (<span class="mono">#12</span>) est une position
              <strong>sur ton écran</strong>, et non un rang officiel dans le fil. Le lien stable
              d’un message est son empreinte.
            </p>
            <details class="det">
              <summary class="det__sum">Le détail</summary>
              <div class="det__body">
                <p>
                  Les messages privés échappent à la fenêtre serrée : leur emballage est antidaté
                  jusqu’à deux jours <em>exprès</em>, pour empêcher un relais de recouper deux
                  copies publiées au même instant. La tolérance est donc réglée par genre d’objet,
                  et non globalement.
                </p>
              </div>
            </details>
          </section>

          <section id="peage" class="ch" data-ch>
            <p class="ch__eyebrow mono">"tags" · nonce</p>
            <h2 class="ch__title display">Le péage : la preuve de travail</h2>
            <p class="ch__lead">
              Avant de partir, ton message doit résoudre une petite énigme de calcul. Tu ne la sens
              pas ; un robot qui poste en boucle, si.
            </p>
            <p>
              L’énigme : trouver un message dont l’empreinte commence par un certain nombre de
              zéros. Comme l’empreinte change entièrement au moindre changement du message, il n’y a
              aucune ruse — il faut essayer. On ajoute donc un nombre sans signification (le
              <em>nonce</em>), on l’incrémente, et on recalcule jusqu’à tomber juste.
            </p>

            <PowLab class="ch__fig" />

            <p>
              Chaque bit demandé double le travail. C’est ce qui rend la mesure honnête : à 14 bits
              tu ne remarques rien, à 20 tu attends, et un robot qui voudrait poster mille fois
              paierait mille fois. Le nonce vit dans les <span class="mono">tags</span>, donc dans
              l’empreinte, donc dans ce qui est signé : impossible de recycler le travail d’un
              message pour un autre.
            </p>
            <p>
              Ce n’est pas la barrière principale, et le prétendre serait mentir : un attaquant
              déterminé paie ce prix. Ce qui coûte vraiment cher à un robot, c’est la limite de
              débit par clé et le fait que personne ne le suive.
            </p>
            <details class="det">
              <summary class="det__sum">Le détail</summary>
              <div class="det__body">
                <p>
                  NIP-13. Le client mesure la vitesse de ta machine au démarrage et choisit une
                  difficulté qui reste imperceptible, jamais en dessous de 14 bits. Si un relais en
                  exige plus — il peut l’annoncer, ou simplement refuser — le plancher monte et le
                  message est reminé.
                </p>
                <p>
                  Le minage réel tourne dans un <em>worker</em>, hors du fil d’affichage : un post
                  ne doit rien geler. Profils et listes ne sont pas taxés, ils n’offrent aucun
                  levier de spam.
                </p>
              </div>
            </details>
          </section>

          <section id="empreinte" class="ch" data-ch>
            <p class="ch__eyebrow mono">"id"</p>
            <h2 class="ch__title display">L’empreinte</h2>
            <p class="ch__lead">
              L’identifiant d’un message n’est pas un numéro qu’on lui attribue : c’est un résumé
              calculé du message lui-même.
            </p>
            <p>
              On met l’objet sous une forme unique — une seule mise en forme est autorisée, sinon
              deux logiciels calculeraient deux résumés différents pour le même message — et on le
              passe dans une fonction de hachage. Le résultat fait 64 caractères. Change une
              virgule, et il n’a plus rien à voir :
            </p>

            <figure class="hp">
              <div class="hp__row">
                <p class="hp__txt">« rendez-vous à 1<span class="hp__diff">4</span> h »</p>
                <p class="hp__id mono">{{ hashA }}</p>
              </div>
              <div class="hp__row">
                <p class="hp__txt">« rendez-vous à 1<span class="hp__diff">5</span> h »</p>
                <p class="hp__id mono">{{ hashB }}</p>
              </div>
              <figcaption class="hp__cap">
                Un chiffre d’écart, et rien de commun entre les deux empreintes. Elles sont calculées
                dans ton navigateur, à l’instant.
              </figcaption>
            </figure>

            <p>Trois conséquences, et elles portent tout le forum :</p>
            <ul>
              <li>
                Deux relais qui t’envoient le même message t’envoient le même identifiant. Le client
                n’en affiche qu’un — c’est ce qui rend la duplication invisible.
              </li>
              <li>
                Personne ne peut retoucher un message : le retoucher lui donne une autre empreinte,
                donc en fait un autre message, qui ne porte plus ta signature.
              </li>
              <li>
                Un lien vers un message est un lien vers <em>ce contenu exact</em>, et pas vers une
                ligne dans une base de données que quelqu’un pourrait modifier.
              </li>
            </ul>
            <details class="det">
              <summary class="det__sum">Le détail</summary>
              <div class="det__body">
                <p>
                  La forme canonique est un tableau JSON strict —
                  <code>[0, pubkey, created_at, kind, tags, content]</code> — haché en SHA-256
                  (NIP-01). Aucune place laissée au style : pas d’espaces, pas de champs
                  réordonnés, pas de clés en plus.
                </p>
              </div>
            </details>
          </section>

          <section id="signature" class="ch" data-ch>
            <p class="ch__eyebrow mono">"sig"</p>
            <h2 class="ch__title display">La signature</h2>
            <p class="ch__lead">
              La signature rend un message attribuable sans qu’aucune autorité n’ait à le confirmer :
              n’importe qui peut vérifier qu’il vient bien de ta clé.
            </p>
            <p>
              Ta clé secrète signe l’empreinte. Ta clé publique permet de vérifier cette signature —
              sans elle, on peut vérifier, mais on ne peut pas signer. Fabriquer demande le secret et
              se fait une fois ; vérifier ne demande que le public et se refait autant qu’on veut,
              n’importe où, y compris hors ligne.
            </p>

            <SchemaSign class="ch__fig" />

            <p>
              Concrètement : aucun relais, aucun administrateur, aucun intermédiaire ne peut te faire
              dire quelque chose. Un relais malveillant peut cacher un message, le retarder, mentir
              par omission — il ne peut pas en forger un. Ton navigateur contrôle la signature de
              chaque objet reçu et jette le reste.
            </p>
            <p>
              Et l’envers, qu’il faut savoir avant de poster : une signature est une preuve, y
              compris contre toi. Tu ne peux pas revenir dire « ce n’était pas moi ».
            </p>
          </section>

          <!-- =============================================== II · LE VOYAGE -->
          <p class="part mono">II · Le voyage</p>

          <section id="relais" class="ch" data-ch>
            <p class="ch__eyebrow mono">EVENT</p>
            <h2 class="ch__title display">Les relais : personne n’héberge le forum</h2>
            <p class="ch__lead">
              Il n’y a pas de serveur Forome. Ton navigateur parle directement à plusieurs machines
              indépendantes, qui stockent les messages et les redonnent à qui les demande.
            </p>
            <p>
              Publier, c’est envoyer le même objet à chacune. Elles répondent une par une, oui ou
              non — d’où le compte « accepté par 3 relais sur 5 » plutôt qu’un « envoyé ». Lire,
              c’est demander à chacune ce qu’elle a, et fusionner les réponses.
            </p>

            <SchemaRelays class="ch__fig" />

            <p>
              Un relais injoignable ne fait pas d’erreur visible : il fait un trou. Ce qui vit
              dessus ne se voit pas ici, ce qu’on lui envoie n’arrive nulle part. C’est pour ça que
              l’en-tête du site affiche un rapport (<span class="mono">4/5 relais</span>) et non un
              simple nombre : le dénominateur est ce qui explique une liste à moitié vide.
            </p>

            <div class="live">
              <p class="live__head">Les relais que ce client interroge</p>
              <ul class="live__list">
                <li v-for="url in relays.relays" :key="url" class="live__row mono">
                  {{ url }}
                  <span v-if="relays.deadRelays.includes(url)" class="live__dead">injoignable</span>
                </li>
              </ul>
              <p v-if="relays.overridden" class="live__note">
                Cette liste vient d’une surcharge de développement, pas de la configuration.
              </p>
            </div>

            <details class="det">
              <summary class="det__sum">Le détail</summary>
              <div class="det__body">
                <p>
                  Le dialogue tient en quelques mots sur une WebSocket :
                  <code>EVENT</code> pour publier ou recevoir, <code>REQ</code> pour s’abonner,
                  <code>EOSE</code> quand l’historique est épuisé, <code>OK</code> pour le verdict
                  d’une publication (NIP-01).
                </p>
                <p>
                  Un relais peut se décrire (NIP-11) : nom, difficulté exigée, paiement requis. La
                  liste par défaut a été mesurée, pas choisie de mémoire — un relais payant y
                  ferait échouer une publication sur cinq en permanence.
                </p>
                <p>
                  Une remarque de fond : la promesse d’incensurabilité n’existe qu’au pluriel. Un
                  relais unique serait un serveur central avec plus d’étapes.
                </p>
              </div>
            </details>
          </section>

          <section id="refus" class="ch" data-ch>
            <p class="ch__eyebrow mono">OK: false</p>
            <h2 class="ch__title display">Ce qu’un relais peut refuser</h2>
            <p class="ch__lead">
              Un relais n’est pas obligé de tout accepter. C’est le seul moment où quelque chose
              peut encore être arrêté : après, c’est trop tard.
            </p>
            <p>
              Chaque relais applique sa propre politique, et rien ne l’oblige à annoncer laquelle.
              Voici celle du relais de ce projet — les relais publics ont les leurs, souvent plus
              permissives :
            </p>

            <table class="tbl">
              <tbody>
                <tr><td class="tbl__k">genres acceptés</td><td>ceux du forum, et rien d’autre</td></tr>
                <tr><td class="tbl__k">preuve de travail</td><td>14 bits sur un message et un MP, aucune sur un profil ou une liste</td></tr>
                <tr><td class="tbl__k">horodatage</td><td>2 min dans le futur, 1 h dans le passé — 2 jours pour un MP</td></tr>
                <tr><td class="tbl__k">débit</td><td>30 objets par minute et par clé</td></tr>
                <tr><td class="tbl__k">taille</td><td>32 ko de texte, 200 tags</td></tr>
                <tr><td class="tbl__k">clés bannies</td><td>refusées avant stockage</td></tr>
                <tr><td class="tbl__k">topics verrouillés</td><td>les réponses ne sont plus acceptées</td></tr>
              </tbody>
            </table>

            <p>
              Ce qu’un relais ne peut pas faire, même mal intentionné : modifier ton message —
              l’empreinte et la signature l’interdisent — ni le faire disparaître du réseau, puisque
              les autres relais en ont leur copie.
            </p>
            <details class="det">
              <summary class="det__sum">Le détail</summary>
              <div class="det__body">
                <p>
                  Cette politique est écrite une seule fois et utilisée à deux endroits : le relais
                  de développement du projet et le greffon du vrai relais. Une seule
                  implémentation, donc ce qui est testé est ce qui tourne.
                </p>
              </div>
            </details>
          </section>

          <section id="ecran" class="ch" data-ch>
            <p class="ch__eyebrow mono">REQ</p>
            <h2 class="ch__title display">Ce qui arrive sur ton écran</h2>
            <p class="ch__lead">
              Ton navigateur ne reçoit pas « le forum ». Il demande à chaque relais ce qui
              correspond à un filtre, et affiche ce qui revient.
            </p>
            <p>
              La vue est donc partielle par construction. Il n’y a pas de « page 1 sur 400 », pas de
              nombre total de messages : ces chiffres supposeraient que quelqu’un tienne le
              registre complet, et personne ne le tient. Le forum affiche ce qu’il a vu.
            </p>
            <p>
              Reste à trier. Et là, un problème apparaît : si chaque client classe les topics selon
              ce que lui a vu passer, deux personnes voient deux forums différents. La réponse tient
              en une inversion — quelqu’un calcule le classement <em>une fois</em> et le publie comme
              un message signé. Tous les clients reçoivent alors les mêmes octets, et surtout ils
              savent <strong>qui</strong> les a produits.
            </p>
            <p>
              Ce classement a un pouvoir réel : il décide de l’ordre de l’écran principal. Il ne peut
              ni retenir ni falsifier un message — ceux-ci vivent sur les relais et restent
              vérifiables sans lui — mais il peut mettre en avant ce qu’il veut. D’où deux
              garde-fous : il est signé, donc attribuable, et il est remplaçable, donc plusieurs
              peuvent exister et le client choisit lequel il écoute. Sans classement épinglé, il
              calcule le sien, sur sa vue partielle.
            </p>
            <p>
              L’activité d’un topic finit sur le petit rail vertical à gauche de chaque rangée
              <span class="rail-demo" aria-hidden="true"
                ><span class="heat heat--hot" style="--fill: 0.8" /></span>
              : plus il est rempli, plus ça parle en ce moment. C’est la seule chose que la couleur
              orange dit dans tout le site.
            </p>
            <details class="det">
              <summary class="det__sum">Le détail</summary>
              <div class="det__body">
                <p>
                  Le classement est publié comme un objet applicatif remplaçable (kind 30078, NIP-78)
                  toutes les deux secondes. Le client vérifie sa signature et n’accepte que celle de
                  la clé qu’il a épinglée : accepter le premier venu donnerait à un inconnu le
                  pouvoir d’ordonner l’écran principal.
                </p>
              </div>
            </details>
          </section>

          <!-- ============================================ III · LES CAS À PART -->
          <p class="part mono">III · Les cas à part</p>

          <section id="prive" class="ch" data-ch>
            <p class="ch__eyebrow mono">kind 1059</p>
            <h2 class="ch__title display">Les messages privés</h2>
            <p class="ch__lead">
              Ce sont les seuls messages chiffrés du site. Ils sont emboîtés trois fois, et chaque
              couche retire une information à quelqu’un.
            </p>

            <SchemaSeal class="ch__fig" />

            <p>
              Au centre, ton texte, <strong>non signé</strong> — délibérément : un message signé et
              déchiffré serait une preuve que ton destinataire pourrait publier. Autour, le sceau,
              chiffré pour lui et signé par toi : lui seul l’ouvre, et il sait que ça vient de toi.
              Autour encore, l’emballage, signé par une clé jetable créée pour ce seul envoi : le
              relais ne voit qu’une enveloppe adressée à quelqu’un, sans expéditeur.
            </p>
            <p>
              Ce que ça coûte, et personne ne le dira à ta place : puisque le relais ne connaît pas
              l’expéditeur, <strong>il ne peut pas bloquer quelqu’un pour toi</strong>. Toute la
              défense se fait chez toi, après déchiffrement — les inconnus arrivent dans une file
              séparée, et leur enveloppe doit payer une preuve de travail.
            </p>
            <p>
              Autre limite, assumée : il n’y a pas de secret persistant. Si ta clé fuit un jour, tout
              l’historique de tes messages privés devient lisible. Ce n’est pas un bug à corriger
              plus tard, c’est la propriété du mécanisme.
            </p>
            <details class="det">
              <summary class="det__sum">Le détail</summary>
              <div class="det__body">
                <p>
                  NIP-17 sur NIP-59 : rumeur (kind 14), sceau (kind 13), emballage cadeau (kind
                  1059), chiffrement NIP-44. Une copie part au destinataire, une autre à toi-même —
                  d’où l’antidatage, sans lequel un relais recouperait les deux.
                </p>
                <p>
                  Les messages privés réclament la clé sur l’appareil : ils ne fonctionnent donc pas
                  quand la signature est déléguée à une extension.
                </p>
              </div>
            </details>
          </section>

          <section id="moderation" class="ch" data-ch>
            <p class="ch__eyebrow mono">kind 1984</p>
            <h2 class="ch__title display">Modérer sans autorité</h2>
            <p class="ch__lead">
              Personne ne peut retirer un message du réseau. Trois pouvoirs existent quand même, et
              ils n’ont pas du tout la même portée.
            </p>
            <ol>
              <li>
                <strong>Toi.</strong> Tu masques une clé, tu en suis d’autres. Ces listes sont des
                objets publiés comme les autres, donc elles ne valent que pour toi — et elles sont
                publiques, ce qui est en soi une information. Point de conception encore ouvert.
              </li>
              <li>
                <strong>Un relais.</strong> Il peut refuser d’accepter quoi que ce soit d’une clé, ou
                verrouiller un topic. C’est le seul pouvoir qui refuse réellement quelque chose,
                parce qu’il agit avant le stockage. Mais il ne vaut que pour <em>ce</em> relais : le
                message continue d’exister ailleurs.
              </li>
              <li>
                <strong>Les signalements.</strong> N’importe qui peut signaler un message ou une
                clé. Ça alimente une file de travail, triée par nombre de voix distinctes — jamais
                une suppression automatique.
              </li>
            </ol>
            <p>
              Le mot juste n’est donc pas « supprimer » mais <strong>cesser de relayer</strong>. Un
              opérateur répond de sa machine, et c’est tout ce qu’il peut tenir.
            </p>
          </section>

          <!-- ========================================= CE QUI EST IMPOSSIBLE -->
          <p class="part mono">Pour finir</p>

          <section id="impossible" class="ch" data-ch>
            <p class="ch__eyebrow mono">kind 5</p>
            <h2 class="ch__title display">Ce que le système ne peut pas faire</h2>
            <p class="ch__lead">
              Voici la liste honnête. Ce ne sont pas des fonctionnalités en retard : ce sont des
              propriétés du réseau, et elles ne changeront pas.
            </p>
            <dl class="lim">
              <dt>Effacer un message</dt>
              <dd>
                Il existe un objet « demande de suppression » (kind 5). C’est une
                <em>demande</em> : un relais peut l’honorer, un autre l’ignorer, et les copies déjà
                téléchargées restent des copies. Rien de ce que tu publies ne peut être rappelé.
              </dd>

              <dt>Récupérer une clé perdue</dt>
              <dd>Aucun mécanisme, aucun recours, aucune exception.</dd>

              <dt>Révoquer une clé volée</dt>
              <dd>
                Rien ne permet de dire « cette clé remplace celle-là ». Le seul remède est de ne
                jamais l’avoir eue sur l’appareil, en déléguant la signature à un signeur distant.
              </dd>

              <dt>Garantir un pseudo</dt>
              <dd>
                Les pseudos ne sont pas réservés : n’importe qui peut prendre le tien. Seule la clé
                distingue, d’où le suffixe affiché partout.
              </dd>

              <dt>Connaître l’heure vraie, ou l’ordre vrai</dt>
              <dd>
                Les horodatages sont déclarés par leurs auteurs. Il n’existe pas d’ordre total des
                messages, seulement un ordre plausible.
              </dd>

              <dt>Compter</dt>
              <dd>
                Ni le nombre de messages, ni celui de participants. Ces nombres supposent un
                registre complet, et il n’y en a pas.
              </dd>
            </dl>
            <p>
              C’est le prix de la promesse inverse : rien ne peut être retiré du réseau, donc rien ne
              peut l’être <em>par erreur ou sous pression</em> non plus.
            </p>
          </section>

          <!-- ============================================== LE CODE OUVERT
               En dernier chapitre, et pas en préambule : la page passe vingt
               écrans à affirmer des propriétés (« personne ne peut effacer »,
               « le relais ne peut pas falsifier »). Le seul moyen de ne pas
               demander qu'on la croie est de dire où ça se vérifie — donc
               après, quand le lecteur sait quoi aller lire. -->
          <section id="code" class="ch" data-ch>
            <p class="ch__eyebrow mono">AGPL-3.0</p>
            <h2 class="ch__title display">Le code est ouvert</h2>
            <p class="ch__lead">
              Tout ce que cette page affirme se lit dans le code, et ce code est public. Rien ici ne
              te demande de nous croire.
            </p>
            <p>
              Le client dans lequel tu lis en ce moment, la règle qui décide ce que notre relais
              accepte ou refuse, le programme qui classe les topics : les trois sont dans le même
              dépôt, avec le raisonnement qui les a produits — les décisions, et les refus
              argumentés. Ce que fait ta clé, où partent tes messages, ce qu’un modérateur peut et ne
              peut pas : ça se vérifie, ligne par ligne.
            </p>
            <p>
              La licence est la <strong>GNU AGPL-3.0</strong>, et elle a une conséquence qui te
              concerne : quiconque héberge une version modifiée de Forome doit en publier les
              sources. Le forum peut donc être copié, réhébergé, amélioré par n’importe qui — mais
              pas refermé en silence. Un site qui te ferait les mêmes promesses avec le même code
              devrait, lui aussi, te montrer ce qu’il en a changé.
            </p>
            <p>
              <a :href="sourceUrl" target="_blank" rel="noopener noreferrer">Lire le code</a> — et
              signaler ce qui ne va pas, ce qui est encore le moyen le plus direct de peser sur un
              forum que personne ne possède.
            </p>
          </section>

          <!-- Ce que la page peut dire de la session en cours, en phrases : les
               mêmes faits en compteurs seraient de l'instrumentation. -->
          <section class="close">
            <h2 class="close__title display">Et pour toi, en ce moment</h2>
            <p class="close__line">
              <template v-if="topics.indexerPubkey">
                Le classement des topics vient de la clé
                <span class="mono">{{ topics.indexerPubkey.slice(0, 8) }}</span
                >, qui le signe — tu peux donc savoir à qui l’attribuer.
              </template>
              <template v-else>
                Aucun classement extérieur n’est épinglé : ton navigateur ordonne la liste lui-même,
                d’après ce qu’il a vu passer depuis son ouverture.
              </template>
            </p>
            <p class="close__line">
              Ta clé, l’endroit où elle vit et ce que tu risques à la perdre :
              <NuxtLink to="/appareils">Mes appareils</NuxtLink>.
            </p>
          </section>
        </article>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * La page qui explique le mécanisme, pour quelqu'un qui n'y connaît rien.
 *
 * Deux partis pris de fond :
 *
 * 1. **L'objet est le plan.** Un message signé a sept champs ; la première
 *    partie leur consacre un chapitre chacun, et la démonstration en tête de page
 *    en fabrique un pour de vrai (clé neuve, minage, signature, vérification —
 *    publié nulle part). Les intitulés de chapitre sont des jetons réels du
 *    protocole (`"pubkey"`, `EVENT`, `OK: false`, `kind 5`) et non une
 *    numérotation décorative : ils disent de quoi le chapitre parle.
 * 2. **Rien qui ne soit vrai.** Aucune empreinte, aucun temps de minage, aucune
 *    liste de relais n'est écrite en dur : tout est calculé ou lu dans les stores.
 *    Les limites du système ont leur propre chapitre, en dernier, parce que c'est
 *    la partie qu'un lecteur ne peut pas deviner seul.
 *
 * La densité du forum (14 px, lignes serrées) ne s'applique pas ici : une page
 * qui se lit d'un bout à l'autre demande un corps plus grand et des mesures
 * courtes. C'est la seule entorse à la charte, et elle est délibérée.
 */
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { getEventHash } from 'nostr-tools/pure'
import { KIND_COMMENT } from '~/types/nostr'

usePageTitle('Comment ça marche')

const relays = useRelayStore()
const topics = useTopicStore()

const sourceUrl = useRuntimeConfig().public.sourceUrl

const PARTS = [
  // Les deux bornes ne sont pas numérotées : le décor et le bilan encadrent le
  // mécanisme, qui est la seule chose à suivre dans l'ordre.
  {
    label: 'Pour commencer',
    items: [
      { id: 'projet', short: 'Ce que c’est' },
      { id: 'nostr', short: 'Nostr, le protocole' },
    ],
  },
  {
    label: 'I · L’objet',
    items: [
      { id: 'cle', short: 'Ta clé est ton compte' },
      { id: 'genre', short: 'Le genre et le texte' },
      { id: 'heure', short: 'L’heure est une déclaration' },
      { id: 'peage', short: 'Le péage : la preuve de travail' },
      { id: 'empreinte', short: 'L’empreinte' },
      { id: 'signature', short: 'La signature' },
    ],
  },
  {
    label: 'II · Le voyage',
    items: [
      { id: 'relais', short: 'Les relais' },
      { id: 'refus', short: 'Ce qu’un relais refuse' },
      { id: 'ecran', short: 'Ce qui arrive sur ton écran' },
    ],
  },
  {
    label: 'III · Les cas à part',
    items: [
      { id: 'prive', short: 'Les messages privés' },
      { id: 'moderation', short: 'Modérer sans autorité' },
    ],
  },
  {
    label: 'Pour finir',
    items: [
      { id: 'impossible', short: 'Ce qui reste impossible' },
      { id: 'code', short: 'Le code est ouvert' },
    ],
  },
]

const scroller = ref<HTMLElement | null>(null)
const active = ref<string | null>(null)

/**
 * Les deux empreintes du chapitre « l'empreinte », calculées et non recopiées :
 * une valeur écrite en dur dans une page qui explique le hachage serait une
 * démonstration en carton.
 */
function idOf(text: string): string {
  return getEventHash({
    kind: KIND_COMMENT,
    pubkey: '0'.repeat(64),
    created_at: 1_700_000_000,
    tags: [],
    content: text,
  })
}
// Deux messages qui ne diffèrent que d'un chiffre — et dont les empreintes ne
// commencent pas par un zéro : au chapitre précédent, les zéros de tête sont la
// preuve de travail, et un hasard qui en produirait ici serait lu comme un lien.
const hashA = idOf('rendez-vous à 14 h')
const hashB = idOf('rendez-vous à 15 h')

const reduced = () =>
  import.meta.client && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * Le défilement appartient à `.doc` et non à la fenêtre (le shell garde
 * l'en-tête fixe), donc `scrollIntoView` sur la section et pas un saut d'ancre :
 * le navigateur ne saurait pas quel conteneur bouger.
 */
function goTo(id: string): void {
  const el = document.getElementById(id)
  if (!el) return
  el.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' })
  // L'URL suit le geste explicite, jamais le défilement : un lien de chapitre
  // doit pouvoir se copier, sans pour autant réécrire l'historique à chaque
  // paragraphe qui passe.
  history.replaceState(null, '', `#${id}`)
}

let observer: IntersectionObserver | null = null

onMounted(() => {
  const sections = Array.from(document.querySelectorAll<HTMLElement>('[data-ch]'))

  // La bande de détection est haute dans le conteneur : le chapitre actif est
  // celui qu'on est en train de lire, pas celui qui vient d'entrer par le bas.
  observer = new IntersectionObserver(
    (entries) => {
      for (const e of entries) if (e.isIntersecting) active.value = e.target.id
    },
    { root: scroller.value, rootMargin: '-22% 0px -70% 0px' },
  )
  sections.forEach((s) => observer?.observe(s))

  const hash = window.location.hash.slice(1)
  if (hash && sections.some((s) => s.id === hash)) {
    document.getElementById(hash)?.scrollIntoView({ block: 'start' })
  }
})

onBeforeUnmount(() => observer?.disconnect())
</script>

<style scoped>
.doc {
  height: 100%;
  overflow-y: auto;
}
.doc__wrap {
  max-width: 1080px;
  margin: 0 auto;
  padding: 4px 0 96px;
}

/* --------------------------------------------------------------------- hero
   La thèse, puis l'objet dont parle tout le reste. Rien d'autre : pas de
   sommaire ici, il commence juste en dessous et vit dans la colonne. */
.hero {
  padding: 40px 44px 32px;
}
.hero__eyebrow {
  margin: 0;
  font-size: var(--fs-xs);
  font-weight: 500;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ink-4);
}
.hero__title {
  margin: 14px 0 0;
  max-width: 26ch;
  font-size: 40px;
  line-height: 1.08;
}
.hero__lead {
  margin: 18px 0 0;
  max-width: 62ch;
  font-size: 17px;
  line-height: 1.62;
  color: var(--ink-2);
}
/* La démonstration ouvre la partie I, pas la page : elle est dans la feuille. */
.sheet__demo {
  margin: 22px 0 0;
  max-width: 660px;
}
.sheet__map {
  margin: 12px 2px 0;
  font-size: 13px;
  color: var(--ink-3);
}

/* --------------------------------------------------------------------- corps */
.doc__body {
  display: grid;
  grid-template-columns: 208px minmax(0, 1fr);
  gap: 36px;
  align-items: start;
  margin-top: 16px;
}

/* ---------------------------------------------------------------------- rail
   Posé à même le canevas, sans carte : c'est un repère, pas un panneau. Le
   marqueur du chapitre courant est BLEU — « où tu es » relève de l'interface,
   l'orange du site ne dit qu'une chose et c'est la chaleur d'un topic. */
.rail {
  position: sticky;
  top: 8px;
  padding: 8px 0 8px 12px;
}
.rail__head {
  margin: 0 0 10px;
  font-size: var(--fs-xs);
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ink-4);
}
.rail__part {
  margin: 16px 0 6px;
  font-size: var(--fs-xs);
  color: var(--ink-4);
}
.rail__part:first-of-type {
  margin-top: 0;
}
.rail__list {
  list-style: none;
  margin: 0;
  padding: 0;
  border-left: 1px solid var(--line);
}
.rail__link {
  display: block;
  padding: 5px 10px;
  margin-left: -1px;
  border-left: 2px solid transparent;
  font-size: var(--fs-md);
  line-height: 1.35;
  color: var(--ink-3);
  text-decoration: none !important;
  transition: color 0.13s ease, border-color 0.13s ease;
}
.rail__link:hover {
  color: var(--ink);
}
.rail__link--on {
  border-left-color: var(--link);
  color: var(--ink);
  font-weight: 600;
}

/* -------------------------------------------------------------------- feuille
   Une seule surface continue pour douze chapitres, et non douze cartes : c'est
   un document qu'on lit d'un bout à l'autre. */
.sheet {
  padding: 8px 48px 44px;
}

/* Changement de registre, donc filet — l'exception que la charte autorise. */
.part {
  margin: 52px 0 0;
  padding-top: 22px;
  border-top: 1px solid var(--line-soft);
  font-size: var(--fs-sm);
  font-weight: 500;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--ink-4);
}

.ch {
  scroll-margin-top: 12px;
  padding-top: 34px;
}
/* Le premier chapitre suit directement l'en-tête : il n'a pas de titre de partie
   à laisser respirer au-dessus de lui. */
.ch--first {
  padding-top: 28px;
}

/* Mode d'emploi de la page, en fin de préambule : c'est une consigne de lecture,
   pas un paragraphe du sujet. Sélecteur doublé pour passer devant `.ch p`. */
.ch p.ch__howto {
  margin-top: 26px;
  padding-top: 12px;
  border-top: 1px solid var(--line-soft);
  font-size: 15px;
  color: var(--ink-3);
}
.ch__eyebrow {
  display: inline-block;
  margin: 0;
  padding: 3px 8px;
  border-radius: var(--r-pastille);
  background: var(--surface-sunken);
  font-size: var(--fs-sm);
  color: var(--ink-3);
}
.ch__title {
  margin: 12px 0 0;
  max-width: 32ch;
  font-size: 27px;
}
/* La phrase « en clair » : le chapitre entier doit pouvoir se résumer à elle. */
.ch__lead {
  margin: 14px 0 0;
  max-width: 58ch;
  font-size: 19px;
  line-height: 1.55;
  font-weight: 500;
  color: var(--ink);
}
.ch p,
.ch ul,
.ch ol,
.ch dl {
  max-width: 66ch;
}
.ch p {
  margin: 16px 0 0;
  font-size: 16px;
  line-height: 1.7;
  color: var(--ink-2);
}
.ch strong {
  color: var(--ink);
}
.ch code {
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--surface-sunken);
  font-size: 13px;
  color: var(--ink-2);
}
.ch ul,
.ch ol {
  margin: 14px 0 0;
  padding-left: 22px;
  font-size: 16px;
  line-height: 1.7;
  color: var(--ink-2);
}
.ch li + li {
  margin-top: 8px;
}

/* Les figures sortent de la mesure du texte : elles ont leur propre échelle. */
.ch__fig {
  margin: 26px 0 4px;
  max-width: 660px;
}

/* ------------------------------------------------------------------ tableaux
   Ni en-tête ni zébrage : deux colonnes, un filet par ligne. Le forum a laissé
   les tableaux de données derrière lui, une page de doc n'a pas à les rouvrir. */
.tbl {
  width: 100%;
  max-width: 620px;
  margin: 22px 0 4px;
  border-collapse: collapse;
  font-size: 15px;
}
.tbl td {
  padding: 9px 12px 9px 0;
  border-top: 1px solid var(--line-soft);
  color: var(--ink-2);
  line-height: 1.5;
  vertical-align: baseline;
}
.tbl tr:first-child td {
  border-top: none;
}
.tbl__k {
  width: 34%;
  padding-right: 18px;
  font-weight: 600;
  color: var(--ink);
  white-space: nowrap;
}

/* Comparaison : deux colonnes de même poids, donc un en-tête est nécessaire pour
   savoir de quel côté on lit. C'est le seul de la page. */
.tbl--cmp {
  max-width: 700px;
  table-layout: fixed;
}
.tbl--cmp th {
  padding: 0 18px 8px 0;
  font-size: var(--fs-xs);
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  text-align: left;
  color: var(--ink-4);
}
.tbl--cmp td {
  padding: 10px 18px 10px 0;
  width: 50%;
}
/* La colonne de droite est celle qui décrit ce forum : c'est elle qui porte
   l'encre pleine, l'autre est le point de comparaison. */
.tbl--cmp td:last-child {
  color: var(--ink);
  padding-right: 0;
}
.tbl--cmp tbody tr:first-child td {
  border-top: 1px solid var(--line);
}

/* ------------------------------------------------------------------- rôles
   Les deux moitiés du protocole, côte à côte : leur symétrie EST l'information —
   il n'y a pas de troisième rôle, et aucun des deux ne commande l'autre. */
.roles {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin: 22px 0 4px;
  max-width: 660px;
}
.roles__one {
  padding: 14px 16px;
  background: var(--surface-sunken);
  border-radius: var(--r-panel);
}
.roles__t {
  margin: 0;
  font-family: var(--font-display);
  font-size: 16px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--ink);
}
.roles__d {
  margin: 6px 0 0;
  font-size: 14px;
  line-height: 1.6;
  color: var(--ink-2);
}

/* --------------------------------------------------- paire d'empreintes vives */
.hp {
  margin: 24px 0 4px;
  padding: 16px 18px;
  background: var(--surface-sunken);
  border: 1px solid var(--line-soft);
  border-radius: var(--r-panel);
  max-width: 660px;
}
.hp__row + .hp__row {
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid var(--line);
}
.hp__txt {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--ink);
}
.hp__diff {
  padding: 0 1px;
  background: var(--link-soft);
  color: var(--link);
  font-weight: 700;
}
.hp__id {
  margin: 6px 0 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--ink-2);
  overflow-wrap: anywhere;
}
.hp__cap {
  margin: 14px 0 0;
  font-size: 13px;
  color: var(--ink-3);
}

/* ------------------------------------------------------------- état réel, vif */
.live {
  margin: 24px 0 4px;
  padding: 14px 16px;
  background: var(--surface-sunken);
  border-radius: var(--r-panel);
  max-width: 660px;
}
.live__head {
  margin: 0;
  font-size: var(--fs-sm);
  font-weight: 700;
  color: var(--ink-2);
}
.live__list {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
}
.live__row {
  display: flex;
  align-items: baseline;
  gap: 10px;
  font-size: var(--fs-sm);
  line-height: 1.9;
  color: var(--ink-3);
  overflow-wrap: anywhere;
}
.live__dead {
  font-family: var(--font-ui);
  font-size: var(--fs-xs);
  font-weight: 700;
  color: var(--warn);
}
.live__note {
  margin: 8px 0 0;
  font-size: var(--fs-sm);
  color: var(--warn);
}

/* ------------------------------------------------------- listes de fin de page */
/* Le corps est repris ici : `max-width` est en `ch`, donc sans lui la liste se
   mesurerait sur les 14 px du forum et ses lignes seraient plus courtes que
   celles des paragraphes voisins. */
.lim {
  margin: 20px 0 0;
  font-size: 16px;
}
.lim dt {
  margin-top: 18px;
  font-family: var(--font-display);
  font-size: 17px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--ink);
}
.lim dd {
  margin: 6px 0 0;
  font-size: 16px;
  line-height: 1.65;
  color: var(--ink-2);
}

/* Le rail de chauffe cité en exemple, à sa taille réelle. */
.rail-demo {
  display: inline-flex;
  height: 15px;
  vertical-align: -2px;
  margin: 0 2px;
}
.rail-demo .heat {
  height: 15px;
}

/* --------------------------------------------------------------- dépliants
   « Le détail » n'est pas un accordéon décoratif : il tient ce qu'un lecteur
   curieux veut et qu'un lecteur pressé ne doit pas avoir à sauter. */
.det {
  margin: 22px 0 0;
  max-width: 660px;
}
.det__sum {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 5px 11px 5px 9px;
  border-radius: 999px;
  background: var(--surface-sunken);
  font-size: var(--fs-sm);
  font-weight: 600;
  color: var(--ink-3);
  cursor: pointer;
  list-style: none;
  user-select: none;
}
.det__sum::-webkit-details-marker {
  display: none;
}
.det__sum::before {
  content: '+';
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--ink-4);
}
.det[open] .det__sum {
  color: var(--ink);
}
.det[open] .det__sum::before {
  content: '−';
}
.det__sum:hover {
  background: var(--surface-3);
  color: var(--ink);
}
.det__body {
  padding: 4px 0 0 9px;
}
.det__body p {
  margin: 14px 0 0;
  font-size: 15px;
  line-height: 1.65;
  color: var(--ink-3);
}
.det__body code {
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--surface-sunken);
  font-family: var(--font-mono);
  font-size: 12.5px;
}

/* ------------------------------------------------------------------ clôture */
.close {
  margin-top: 52px;
  padding: 24px 0 0;
  border-top: 1px solid var(--line-soft);
}
.close__title {
  margin: 0;
  font-size: 19px;
}
.close__line {
  margin: 12px 0 0;
  max-width: 66ch;
  font-size: 15px;
  line-height: 1.65;
  color: var(--ink-2);
}

/* ---------------------------------------------------------------- < 1000 px
   Le sommaire cesse d'être une colonne et redevient ce qu'il est : une table
   des matières, en tête du document. */
@media (max-width: 1000px) {
  .doc__body {
    display: block;
  }
  .rail {
    position: static;
    padding: 18px 4px 0;
  }
  .rail__link--on {
    border-left-color: var(--link);
  }
  .sheet {
    margin-top: 14px;
  }
}

/* Les deux rôles empilés plutôt que deux colonnes de 150 px, où chaque mot
   tiendrait seul sur sa ligne. */
@media (max-width: 620px) {
  .roles {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 700px) {
  .doc__wrap {
    padding-bottom: 64px;
  }
  .hero {
    padding: 26px 20px 22px;
    border-radius: 0;
  }
  .hero__title {
    font-size: 30px;
    max-width: none;
  }
  .hero__lead {
    font-size: 16px;
  }
  .sheet {
    padding: 4px 20px 32px;
    border-radius: 0;
  }
  .ch__title {
    font-size: 23px;
  }
  .ch__lead {
    font-size: 17.5px;
  }
  .ch p,
  .ch ul,
  .ch ol {
    font-size: 15.5px;
  }
  .tbl {
    font-size: 14px;
  }
  .tbl__k {
    width: 40%;
    white-space: normal;
  }
}
</style>
