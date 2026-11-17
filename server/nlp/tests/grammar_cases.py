"""Hand-labelled Dutch sentences for the grammar detectors (own sentences, no textbook text).

``CASES[topic] = (positives, negatives)``: every positive must produce a hit for ``topic``, no
negative may. Negatives are chosen to be tempting (same words, different construction).
"""

CASES: dict[str, tuple[list[str], list[str]]] = {
    "inversion": (
        [
            "Morgen ga ik naar school.",
            "Gisteren kocht hij een nieuwe fiets.",
            "Na het eten wassen wij af.",
            "Op zaterdag bezoekt zij haar oma.",
            "Daarom heb ik de brief niet gelezen.",
        ],
        [
            "Ik ga morgen naar school.",
            "Hij kocht gisteren een nieuwe fiets.",
            "Waar woon jij?",
            "Ik bel je morgen op.",
            "Er staat een kat op het dak.",
            "Dit is Toms fiets.",
            "Wat is de wereld toch klein!",
        ],
    ),
    "questions": (
        [
            "Waar woon jij?",
            "Wat wil je drinken?",
            "Heb jij honger?",
            "Waarom komt hij niet?",
            "Kunnen wij morgen afspreken?",
        ],
        [
            "Ik weet niet waar hij woont.",
            "Hij vroeg wat ik wilde drinken.",
            "Je hebt honger.",
            "Wij gaan morgen naar het strand.",
        ],
    ),
    "subordinate-clauses": (
        [
            "Ik blijf thuis omdat het regent.",
            "Ik denk dat hij morgen komt.",
            "Als ik moe ben, ga ik slapen.",
            "Zij zegt dat zij het boek heeft gelezen.",
            "Hij bleef thuis terwijl zijn vrouw naar het werk ging.",
        ],
        [
            "Hij komt morgen.",
            "Ik blijf thuis, want het regent.",
            "Hij is groter dan zijn broer.",
            "Wij eten en daarna gaan wij wandelen.",
        ],
    ),
    "separable-verbs": (
        [
            "Hij belt zijn moeder op.",
            "Zij kwam gisteren aan in Amsterdam.",
            "Ik sta elke dag om zeven uur op.",
            "Wij ruimen de kamer op.",
        ],
        [
            "Ik heb mijn moeder opgebeld.",
            "Hij loopt op straat.",
            "Zij is vandaag thuis.",
            "Zij wonen in Amsterdam.",
            "Hij wil zijn moeder opbellen.",
        ],
    ),
    "perfect-tense": (
        [
            "Gisteren heb ik de kinderen gezien.",
            "Zij zijn naar huis gegaan.",
            "Wij hebben de hele avond gewerkt.",
            "Hij is gisteren in Rotterdam aangekomen.",
            "Ik heb een boek gekocht.",
        ],
        [
            "Ik lees een boek.",
            "Het huis is gebouwd door een bekende architect.",
            "Hij heeft veel geld.",
            "Zij zijn erg blij.",
        ],
    ),
    "modal-verbs": (
        [
            "Ik wil morgen naar de markt gaan.",
            "Je moet nu naar bed gaan.",
            "Kunnen jullie ons helpen?",
            "Hij mag hier niet roken.",
            "Wij moeten dit werk vandaag afmaken.",
        ],
        [
            "Ik wil water.",
            "Ik ga morgen naar de markt.",
            "Hij kan het niet.",
            "Zij heeft veel geld.",
        ],
    ),
    "imperfect-tense": (
        [
            "Zij liep elke dag naar school.",
            "Hij vergat zijn tas.",
            "Wij woonden vroeger in Utrecht.",
            "Het was een mooie dag.",
        ],
        [
            "Zij loopt elke dag naar school.",
            "Hij heeft zijn tas vergeten.",
            "Wij wonen in Utrecht.",
            "Hij zal zijn tas vergeten.",
        ],
    ),
    "future": (
        [
            "Ik zal morgen komen.",
            "Wij gaan volgend jaar verhuizen.",
            "Het gaat regenen.",
            "Zij zullen de brief morgen sturen.",
        ],
        [
            "Ik ga naar huis.",
            "Hij komt morgen.",
            "Ik kan morgen komen.",
            "Wij zijn gisteren verhuisd.",
            "Hij ging naar huis.",
            "Ik zou graag koffie willen.",
        ],
    ),
    "reflexive-verbs": (
        [
            "Hij heeft zich gisteren verslapen.",
            "Wij wassen ons elke ochtend.",
            "Zij herinnert zich haar eerste dag nog goed.",
            "Ik wil me even omkleden.",
        ],
        [
            "Hij ziet haar elke dag.",
            "Ik zie je morgen.",
            "Hij geeft ons een boek.",
            "Jij kent mijn vader.",
            "Je zult je bananen eten.",
        ],
    ),
    "om-te-infinitive": (
        [
            "Hij vergat om zijn tas mee te nemen.",
            "Het is te laat om te gaan.",
            "Ik ga naar de winkel om brood te kopen.",
            "Zij leert Nederlands om hier te kunnen werken.",
        ],
        [
            "De les begint om negen uur.",
            "Ik probeer het huis te verkopen.",
            "Het is te groot.",
        ],
    ),
    "te-infinitive": (
        [
            "Ik probeer het huis te verkopen.",
            "Zij begint een brief te schrijven.",
            "Hij weigerde mij te helpen.",
            "Het is leuk jou te zien.",
        ],
        [
            "Het is te groot.",
            "Hij gaat om brood te kopen.",
            "Wij moeten dit werk afmaken.",
        ],
    ),
    "adjective-inflection": (
        [
            "Het is een mooie dag.",
            "Het meisje heeft een kleine hond.",
            "Wij wonen in een groot huis.",
            "De oude man loopt langzaam.",
        ],
        [
            "Het huis is groot.",
            "De dag was mooi.",
            "Hij is erg moe.",
        ],
    ),
    "comparison": (
        [
            "Hij is groter dan zijn broer.",
            "Dit is het mooiste huis van de straat.",
            "Zij loopt sneller dan ik.",
            "Deze tas is duurder dan die.",
        ],
        [
            "Hij is groot.",
            "Ik wil meer koffie.",
            "Dit is de eerste keer.",
            "Je zult jaloers zijn.",
            "Toronto heette vroeger Fort York.",
        ],
    ),
    "negation": (
        [
            "Ik ga niet naar huis.",
            "Ik heb geen tijd.",
            "Hij komt vandaag niet.",
            "Zij hebben geen auto.",
        ],
        [
            "Ik ga naar huis.",
            "Ik heb tijd.",
            "Hij is er.",
        ],
    ),
    "demonstratives": (
        [
            "Dit boek is mooi.",
            "Die tas is van mij.",
            "Ik wil deze appels kopen.",
            "Dat huis is te duur.",
        ],
        [
            "Ik denk dat hij komt.",
            "Het boek dat ik las, was dik.",
            "De man die daar staat, is mijn buurman.",
        ],
    ),
    "er": (
        [
            "Er staat een kat op het dak.",
            "Ik heb er twee.",
            "Ik denk er niet aan.",
            "Zij woont er al jaren.",
        ],
        [
            "Hij is groter dan zijn broer.",
            "Ik ga naar huis.",
            "Dat is mooier.",
        ],
    ),
    "relative-pronouns": (
        [
            "Het boek dat ik las, was erg dik.",
            "De man die daar staat, is mijn buurman.",
            "Dit is de vrouw die hier woont.",
            "Alles wat hij zegt, is waar.",
        ],
        [
            "Ik denk dat hij komt.",
            "Die man is mijn buurman.",
            "Ik weet waar hij woont.",
            "We boffen dat het weer zo mooi is.",
        ],
    ),
    "de-het": (
        [
            "Het meisje heeft een hondje.",
            "Ik wil een koekje en een kopje thee.",
            "Zij kocht een boekje.",
            "Het kindje slaapt.",
        ],
        [
            "De hond slaapt.",
            "Ik drink koffie.",
            "De oranje auto staat hier.",
        ],
    ),
    "plural-nouns": (
        [
            "De kinderen spelen buiten.",
            "Ik heb twee katten.",
            "Hij leest de boeken.",
            "Wij kopen appels en peren.",
        ],
        [
            "Het kind speelt buiten.",
            "Ik heb een kat.",
            "Hij leest het boek.",
        ],
    ),
    "imperative": (
        [
            "Kom hier!",
            "Open het raam, alsjeblieft.",
            "Doe de deur dicht.",
            "Wees stil.",
        ],
        [
            "Ik open het raam.",
            "Kom jij morgen?",
            "Hij komt hier.",
            "Gisteren liep ik naar huis.",
        ],
    ),
    "indirect-speech": (
        [
            "Hij zei dat hij moe was.",
            "Zij vertelde dat zij naar Spanje ging.",
            "Ik denk dat het morgen regent.",
            "Hij vroeg of ik kwam.",
        ],
        [
            "Hij zei: ik ben moe.",
            "Ik blijf thuis omdat het regent.",
            "Het boek dat ik las, was dik.",
        ],
    ),
    "conjunctions": (
        [
            "Ik ben moe, maar ik blijf werken.",
            "Zij liep naar school en hij fietste naar zijn werk.",
            "Ik blijf thuis, want ik ben ziek.",
        ],
        [
            "Ik blijf thuis omdat ik ziek ben.",
            "Ik eet brood en kaas.",
            "Hij is arm maar gelukkig.",
        ],
    ),
}
