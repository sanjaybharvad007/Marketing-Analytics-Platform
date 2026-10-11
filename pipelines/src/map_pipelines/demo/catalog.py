"""The fictional Northpeak Outfitters site: pages, the queries they rank for, and tracked prompts.

Everything here is invented. Hostnames use the reserved `.example` TLD.
"""

from __future__ import annotations

from dataclasses import dataclass

BRAND_NAME = "Northpeak Outfitters"
BRAND_SHORT = "northpeak"
SITE_URL = "https://www.northpeak.example"

COUNTRIES: tuple[str, ...] = ("US", "CA", "GB", "DE", "AU")
DEVICES: tuple[str, ...] = ("mobile", "desktop", "tablet")
CHANNELS: tuple[str, ...] = (
    "Organic Search",
    "Direct",
    "Paid Search",
    "Email",
    "Organic Social",
    "Referral",
)


@dataclass(frozen=True)
class DemoPage:
    path: str
    title: str
    topic: str
    # Relative organic demand; 1.0 is a typical article.
    weight: float
    word_count: int
    # Published this many days before the anchor date.
    age_days: int
    # Seed search terms. How they expand into queries depends on the page type.
    terms: tuple[str, ...]


LANDING_PAGES: tuple[DemoPage, ...] = (
    DemoPage(
        "/",
        "Northpeak Outfitters: Gear for the Long Way Round",
        "brand",
        1.3,
        640,
        1900,
        (
            "northpeak outfitters",
            "northpeak",
            "north peak outfitters",
            "northpeek outfitters",
            "northpeak outfitters coupon",
            "northpeak outfitters returns",
            "outdoor gear store",
        ),
    ),
    DemoPage(
        "/sale/",
        "Outdoor Gear Sale",
        "deals",
        1.6,
        420,
        900,
        ("outdoor gear sale", "camping gear clearance", "northpeak sale", "hiking gear deals"),
    ),
    DemoPage(
        "/gift-guide/",
        "Gift Guide for Hikers and Campers",
        "deals",
        0.9,
        1150,
        330,
        ("gifts for hikers", "camping gifts", "gifts for backpackers", "outdoor gift ideas"),
    ),
    DemoPage(
        "/trade-in/",
        "Trade In Your Used Gear",
        "sustainability",
        0.7,
        780,
        410,
        (
            "used outdoor gear",
            "gear trade in program",
            "northpeak trade in",
            "sell used camping gear",
        ),
    ),
    DemoPage(
        "/about/",
        "About Northpeak Outfitters",
        "brand",
        0.5,
        860,
        1900,
        (
            "northpeak outfitters reviews",
            "is northpeak outfitters legit",
            "northpeak outfitters sustainability",
        ),
    ),
)

# Category terms: (head term, secondary term, qualified variant)
CATEGORY_PAGES: tuple[DemoPage, ...] = (
    DemoPage(
        "/categories/tents/",
        "Tents",
        "tents",
        2.6,
        520,
        1400,
        ("backpacking tents", "camping tents", "lightweight 2 person tent"),
    ),
    DemoPage(
        "/categories/backpacks/",
        "Backpacks",
        "backpacks",
        2.4,
        480,
        1400,
        ("hiking backpacks", "backpacking packs", "50 liter backpack"),
    ),
    DemoPage(
        "/categories/sleeping-bags/",
        "Sleeping Bags",
        "sleeping bags",
        2.2,
        510,
        1400,
        ("sleeping bags", "down sleeping bags", "20 degree sleeping bag"),
    ),
    DemoPage(
        "/categories/hiking-boots/",
        "Hiking Boots and Shoes",
        "footwear",
        2.5,
        470,
        1400,
        ("hiking boots", "waterproof hiking boots", "trail shoes"),
    ),
    DemoPage(
        "/categories/rain-jackets/",
        "Rain Jackets",
        "rainwear",
        1.9,
        450,
        1300,
        ("rain jackets", "waterproof jackets", "3 layer rain jacket"),
    ),
    DemoPage(
        "/categories/camp-stoves/",
        "Camp Stoves",
        "camp kitchen",
        1.3,
        430,
        1200,
        ("camp stoves", "backpacking stoves", "canister stove"),
    ),
    DemoPage(
        "/categories/trekking-poles/",
        "Trekking Poles",
        "poles",
        1.1,
        400,
        1100,
        ("trekking poles", "hiking poles", "carbon trekking poles"),
    ),
    DemoPage(
        "/categories/headlamps/",
        "Headlamps",
        "lighting",
        1.0,
        390,
        1100,
        ("headlamps", "rechargeable headlamp", "camping headlamp"),
    ),
)

# Product terms: (product name, generic term, generic term)
PRODUCT_PAGES: tuple[DemoPage, ...] = (
    DemoPage(
        "/products/ridgeline-2p-tent/",
        "Ridgeline 2P Backpacking Tent",
        "tents",
        1.5,
        690,
        620,
        ("ridgeline 2p tent", "2 person backpacking tent", "freestanding backpacking tent"),
    ),
    DemoPage(
        "/products/basecamp-4p-tent/",
        "Basecamp 4P Family Tent",
        "tents",
        1.1,
        640,
        540,
        ("basecamp 4p tent", "4 person camping tent", "family tent with vestibule"),
    ),
    DemoPage(
        "/products/skyline-ul-1p-tent/",
        "Skyline UL 1P Tent",
        "tents",
        1.0,
        710,
        40,
        ("skyline ul 1p tent", "ultralight 1 person tent", "solo backpacking tent"),
    ),
    DemoPage(
        "/products/traverse-55-backpack/",
        "Traverse 55L Backpack",
        "backpacks",
        1.4,
        670,
        700,
        ("traverse 55 backpack", "55l backpacking pack", "multi day hiking backpack"),
    ),
    DemoPage(
        "/products/daybreak-22-daypack/",
        "Daybreak 22L Daypack",
        "backpacks",
        1.0,
        560,
        480,
        ("daybreak 22 daypack", "22l hiking daypack", "lightweight daypack"),
    ),
    DemoPage(
        "/products/frostline-20-sleeping-bag/",
        "Frostline 20°F Down Sleeping Bag",
        "sleeping bags",
        1.3,
        720,
        650,
        ("frostline 20 sleeping bag", "20 degree down sleeping bag", "3 season sleeping bag"),
    ),
    DemoPage(
        "/products/emberlight-35-sleeping-bag/",
        "Emberlight 35°F Synthetic Sleeping Bag",
        "sleeping bags",
        0.8,
        610,
        390,
        ("emberlight 35 sleeping bag", "synthetic sleeping bag", "summer sleeping bag"),
    ),
    DemoPage(
        "/products/cairn-mid-hiking-boot/",
        "Cairn Mid Waterproof Hiking Boot",
        "footwear",
        1.5,
        680,
        760,
        ("cairn mid hiking boot", "mid waterproof hiking boots", "leather hiking boots"),
    ),
    DemoPage(
        "/products/switchback-trail-shoe/",
        "Switchback Trail Shoe",
        "footwear",
        1.1,
        590,
        300,
        ("switchback trail shoe", "trail running shoes for hiking", "lightweight hiking shoes"),
    ),
    DemoPage(
        "/products/stormshell-rain-jacket/",
        "Stormshell 3L Rain Jacket",
        "rainwear",
        1.2,
        650,
        520,
        ("stormshell rain jacket", "3 layer waterproof jacket", "packable rain jacket"),
    ),
    DemoPage(
        "/products/pocket-burner-stove/",
        "Pocket Burner Backpacking Stove",
        "camp kitchen",
        0.9,
        540,
        830,
        ("pocket burner stove", "ultralight backpacking stove", "canister stove with igniter"),
    ),
    DemoPage(
        "/products/carbon-trek-poles/",
        "Carbon Trek Trekking Poles",
        "poles",
        0.8,
        520,
        450,
        ("carbon trek poles", "folding trekking poles", "ultralight trekking poles"),
    ),
    DemoPage(
        "/products/beacon-400-headlamp/",
        "Beacon 400 Headlamp",
        "lighting",
        0.8,
        500,
        360,
        ("beacon 400 headlamp", "400 lumen headlamp", "usb rechargeable headlamp"),
    ),
    DemoPage(
        "/products/alpine-sleeping-pad/",
        "Alpine Insulated Sleeping Pad",
        "sleeping bags",
        0.9,
        580,
        270,
        ("alpine sleeping pad", "insulated sleeping pad", "4 season sleeping pad"),
    ),
)

# Article and guide terms are complete queries, strongest first.
BLOG_PAGES: tuple[DemoPage, ...] = (
    DemoPage(
        "/blog/best-backpacking-tents-2025/",
        "The Best Backpacking Tents of 2025",
        "tents",
        2.3,
        2850,
        560,
        (
            "best backpacking tents",
            "best backpacking tents 2025",
            "best 2 person backpacking tent",
            "best lightweight tent",
            "backpacking tent reviews",
        ),
    ),
    DemoPage(
        "/blog/winter-camping-checklist/",
        "Winter Camping Checklist",
        "camping",
        1.6,
        1900,
        700,
        (
            "winter camping checklist",
            "winter camping gear list",
            "what to bring winter camping",
            "cold weather camping essentials",
            "winter camping tips",
        ),
    ),
    DemoPage(
        "/blog/best-hiking-boots-for-wide-feet/",
        "Best Hiking Boots for Wide Feet",
        "footwear",
        1.5,
        2300,
        420,
        (
            "best hiking boots for wide feet",
            "wide hiking boots",
            "wide toe box hiking boots",
            "hiking boots wide width women's",
            "best hiking shoes for wide feet",
        ),
    ),
    DemoPage(
        "/blog/down-vs-synthetic-sleeping-bags/",
        "Down vs Synthetic Sleeping Bags",
        "sleeping bags",
        1.4,
        1750,
        510,
        (
            "down vs synthetic sleeping bag",
            "down or synthetic sleeping bag",
            "is down warmer than synthetic",
            "synthetic vs down insulation",
            "best sleeping bag insulation",
        ),
    ),
    DemoPage(
        "/blog/ultralight-backpacking-gear-list/",
        "Ultralight Backpacking Gear List",
        "backpacks",
        1.8,
        2600,
        380,
        (
            "ultralight backpacking gear list",
            "ultralight gear list",
            "ultralight backpacking base weight",
            "10 lb base weight gear list",
            "ultralight backpacking essentials",
        ),
    ),
    DemoPage(
        "/blog/how-to-waterproof-a-tent/",
        "How to Waterproof a Tent",
        "tents",
        1.3,
        1500,
        640,
        (
            "how to waterproof a tent",
            "tent seam sealer",
            "reproof tent rainfly",
            "tent waterproofing spray",
            "how to seam seal a tent",
        ),
    ),
    DemoPage(
        "/blog/best-day-hikes-near-denver/",
        "The Best Day Hikes near Denver",
        "trails",
        1.2,
        2100,
        290,
        (
            "best day hikes near denver",
            "hikes near denver",
            "easy hikes near denver",
            "denver hiking trails",
            "front range day hikes",
        ),
    ),
    DemoPage(
        "/blog/camp-coffee-methods/",
        "Seven Ways to Make Coffee at Camp",
        "camp kitchen",
        1.0,
        1650,
        470,
        (
            "camp coffee",
            "how to make coffee while camping",
            "best camping coffee maker",
            "backpacking coffee",
            "pour over camping coffee",
        ),
    ),
    DemoPage(
        "/blog/hiking-with-dogs-tips/",
        "Hiking with Dogs: What to Know",
        "trails",
        1.0,
        1800,
        350,
        (
            "hiking with dogs",
            "hiking with dogs tips",
            "dog hiking gear",
            "how far can a dog hike",
            "best dog backpack for hiking",
        ),
    ),
    DemoPage(
        "/blog/best-budget-backpacks/",
        "Best Budget Backpacks for Backpacking",
        "backpacks",
        1.4,
        2400,
        240,
        (
            "best budget backpacks",
            "best budget backpacking pack",
            "cheap hiking backpack",
            "backpacking pack under 150",
            "affordable backpacking backpack",
        ),
    ),
    DemoPage(
        "/blog/leave-no-trace-principles/",
        "The Seven Leave No Trace Principles",
        "sustainability",
        0.9,
        1400,
        820,
        (
            "leave no trace principles",
            "7 leave no trace principles",
            "leave no trace camping",
            "what is leave no trace",
            "leave no trace hiking",
        ),
    ),
    DemoPage(
        "/blog/thru-hiking-resupply-strategy/",
        "Planning a Thru-Hike Resupply",
        "trails",
        0.8,
        2250,
        200,
        (
            "thru hike resupply",
            "resupply strategy thru hiking",
            "how to resupply on a thru hike",
            "resupply box ideas",
            "thru hiking food plan",
        ),
    ),
    DemoPage(
        "/blog/best-headlamps-for-running/",
        "Best Headlamps for Trail Running",
        "lighting",
        0.9,
        1950,
        310,
        (
            "best headlamps for running",
            "trail running headlamp",
            "best running headlamp",
            "lightweight headlamp for running",
            "headlamp for night running",
        ),
    ),
    DemoPage(
        "/blog/gear-repair-at-home/",
        "Repairing Outdoor Gear at Home",
        "sustainability",
        0.8,
        1700,
        150,
        (
            "outdoor gear repair",
            "how to patch a down jacket",
            "fix a tent zipper",
            "repair sleeping pad leak",
            "gear repair kit",
        ),
    ),
)

GUIDE_PAGES: tuple[DemoPage, ...] = (
    DemoPage(
        "/guides/how-to-choose-a-backpacking-tent/",
        "How to Choose a Backpacking Tent",
        "tents",
        1.9,
        3100,
        330,
        (
            "how to choose a backpacking tent",
            "backpacking tent buying guide",
            "what size backpacking tent do i need",
            "single wall vs double wall tent",
            "backpacking tent weight",
        ),
    ),
    DemoPage(
        "/guides/sleeping-bag-temperature-ratings/",
        "Sleeping Bag Temperature Ratings Explained",
        "sleeping bags",
        1.8,
        2700,
        300,
        (
            "sleeping bag temperature ratings",
            "sleeping bag comfort rating vs limit",
            "en iso sleeping bag rating",
            "what temperature sleeping bag do i need",
            "sleeping bag rating chart",
        ),
    ),
    DemoPage(
        "/guides/how-to-fit-a-backpack/",
        "How to Fit a Backpack",
        "backpacks",
        1.5,
        2200,
        280,
        (
            "how to fit a backpack",
            "how to measure torso length",
            "backpack sizing guide",
            "how should a hiking backpack fit",
            "adjust backpack straps",
        ),
    ),
    DemoPage(
        "/guides/hiking-boot-sizing/",
        "Hiking Boot Sizing and Fit",
        "footwear",
        1.5,
        2050,
        260,
        (
            "hiking boot sizing",
            "how should hiking boots fit",
            "hiking boots size up or down",
            "how to break in hiking boots",
            "hiking boot fit guide",
        ),
    ),
    DemoPage(
        "/guides/layering-for-cold-weather/",
        "Layering for Cold Weather",
        "rainwear",
        1.4,
        2400,
        240,
        (
            "layering for cold weather",
            "how to layer for hiking",
            "base layer mid layer shell",
            "winter hiking layers",
            "layering system explained",
        ),
    ),
    DemoPage(
        "/guides/how-to-choose-trekking-poles/",
        "How to Choose Trekking Poles",
        "poles",
        1.1,
        1900,
        220,
        (
            "how to choose trekking poles",
            "trekking pole length",
            "carbon vs aluminum trekking poles",
            "are trekking poles worth it",
            "trekking pole height chart",
        ),
    ),
    DemoPage(
        "/guides/backpacking-stove-fuel-types/",
        "Backpacking Stove Fuel Types",
        "camp kitchen",
        1.0,
        1850,
        210,
        (
            "backpacking stove fuel types",
            "isobutane vs propane",
            "how long does a fuel canister last",
            "white gas vs canister stove",
            "backpacking fuel calculator",
        ),
    ),
    DemoPage(
        "/guides/rain-jacket-waterproof-ratings/",
        "Rain Jacket Waterproof Ratings",
        "rainwear",
        1.3,
        2150,
        190,
        (
            "waterproof ratings explained",
            "rain jacket waterproof rating",
            "what is 20k waterproof",
            "2 layer vs 3 layer rain jacket",
            "breathability rating jackets",
        ),
    ),
    DemoPage(
        "/guides/backpacking-for-beginners/",
        "Backpacking for Beginners",
        "backpacks",
        2.0,
        3400,
        350,
        (
            "backpacking for beginners",
            "how to start backpacking",
            "beginner backpacking gear list",
            "first backpacking trip tips",
            "backpacking checklist",
        ),
    ),
    DemoPage(
        "/guides/how-to-pack-a-backpack/",
        "How to Pack a Backpack",
        "backpacks",
        1.4,
        1950,
        310,
        (
            "how to pack a backpack",
            "how to pack a backpacking pack",
            "backpack weight distribution",
            "where to pack sleeping bag in backpack",
            "packing a hiking backpack",
        ),
    ),
    DemoPage(
        "/guides/tent-footprint-guide/",
        "Do You Need a Tent Footprint?",
        "tents",
        1.0,
        1600,
        170,
        (
            "tent footprint",
            "do i need a tent footprint",
            "tent footprint vs tarp",
            "what is a tent footprint",
            "diy tent footprint",
        ),
    ),
    DemoPage(
        "/guides/headlamp-lumens-explained/",
        "Headlamp Lumens Explained",
        "lighting",
        0.9,
        1500,
        140,
        (
            "headlamp lumens",
            "how many lumens for a headlamp",
            "headlamp brightness guide",
            "red light headlamp use",
            "headlamp beam distance",
        ),
    ),
)

# Store terms: (city,)
STORE_PAGES: tuple[DemoPage, ...] = (
    DemoPage(
        "/stores/",
        "Store Locations",
        "stores",
        0.9,
        310,
        1900,
        ("northpeak store locations", "outdoor gear store near me", "camping store near me"),
    ),
    DemoPage("/stores/denver/", "Northpeak Denver", "stores", 0.8, 420, 1700, ("denver",)),
    DemoPage("/stores/boulder/", "Northpeak Boulder", "stores", 0.5, 400, 1300, ("boulder",)),
    DemoPage("/stores/seattle/", "Northpeak Seattle", "stores", 0.7, 410, 1100, ("seattle",)),
    DemoPage("/stores/portland/", "Northpeak Portland", "stores", 0.6, 405, 900, ("portland",)),
    DemoPage("/stores/vancouver/", "Northpeak Vancouver", "stores", 0.6, 415, 600, ("vancouver",)),
    DemoPage("/stores/calgary/", "Northpeak Calgary", "stores", 0.4, 395, 320, ("calgary",)),
)

ALL_PAGES: tuple[DemoPage, ...] = (
    *LANDING_PAGES,
    *CATEGORY_PAGES,
    *PRODUCT_PAGES,
    *BLOG_PAGES,
    *GUIDE_PAGES,
    *STORE_PAGES,
)

CANADIAN_STORES = frozenset({"vancouver", "calgary"})

# --- Stories the dashboards should make visible -----------------------------

# The guides section has been growing steadily since a content push.
GROWING_SECTION = "guides"

# Two articles are losing clicks: one carries last year's date in its title,
# the other has been overtaken on its main terms.
DECAYING_PATHS = frozenset(
    {
        "/blog/best-backpacking-tents-2025/",
        "/blog/winter-camping-checklist/",
    }
)

# High-demand queries sitting at the bottom of page one or on page two with a
# weak click-through rate. `map opportunities` should surface these.
STRIKING_DISTANCE_QUERIES = frozenset(
    {
        "backpacking tents",
        "hiking backpacks",
        "sleeping bags",
        "waterproof hiking boots",
        "rain jackets",
        "trekking poles",
        "best budget backpacks",
        "ultralight backpacking gear list",
        "best hiking boots for wide feet",
        "2 person backpacking tent",
        "20 degree down sleeping bag",
        "backpacking for beginners",
        "how to layer for hiking",
        "best running headlamp",
        "camp coffee",
        "insulated sleeping pad",
    }
)


@dataclass(frozen=True)
class DemoPrompt:
    prompt: str
    topic: str
    intent: str


AI_PROMPTS: tuple[DemoPrompt, ...] = (
    DemoPrompt("What are the best backpacking tents for two people?", "Tents", "commercial"),
    DemoPrompt("Which brands make reliable ultralight tents?", "Tents", "commercial"),
    DemoPrompt("How do I choose a tent for my first backpacking trip?", "Tents", "informational"),
    DemoPrompt("What is a good family camping tent under $400?", "Tents", "transactional"),
    DemoPrompt("Do I need a footprint for my backpacking tent?", "Tents", "informational"),
    DemoPrompt(
        "What is the best 55 liter backpack for multi-day hikes?", "Backpacks", "commercial"
    ),
    DemoPrompt("Which hiking backpack brands have the best fit?", "Backpacks", "commercial"),
    DemoPrompt("How should a backpacking pack fit my torso?", "Backpacks", "informational"),
    DemoPrompt("What are good budget backpacks for beginners?", "Backpacks", "commercial"),
    DemoPrompt("Where can I buy a lightweight daypack online?", "Backpacks", "transactional"),
    DemoPrompt("What is the best 20 degree down sleeping bag?", "Sleeping bags", "commercial"),
    DemoPrompt(
        "Down or synthetic: which sleeping bag should I buy?", "Sleeping bags", "commercial"
    ),
    DemoPrompt("How do sleeping bag temperature ratings work?", "Sleeping bags", "informational"),
    DemoPrompt("Which brands make the warmest sleeping bags?", "Sleeping bags", "commercial"),
    DemoPrompt("What is a good insulated sleeping pad for winter?", "Sleeping bags", "commercial"),
    DemoPrompt("What are the best waterproof hiking boots?", "Footwear", "commercial"),
    DemoPrompt("Which hiking boots are best for wide feet?", "Footwear", "commercial"),
    DemoPrompt("Should I hike in boots or trail shoes?", "Footwear", "informational"),
    DemoPrompt("How should hiking boots fit?", "Footwear", "informational"),
    DemoPrompt("Where can I buy trail shoes with a wide toe box?", "Footwear", "transactional"),
    DemoPrompt("What is the best rain jacket for hiking?", "Rainwear", "commercial"),
    DemoPrompt("Are 3-layer rain jackets worth the price?", "Rainwear", "commercial"),
    DemoPrompt("What do waterproof ratings on jackets mean?", "Rainwear", "informational"),
    DemoPrompt("Which brands make durable rain shells?", "Rainwear", "commercial"),
    DemoPrompt("How do I layer clothing for cold-weather hiking?", "Rainwear", "informational"),
    DemoPrompt("What is the best backpacking stove?", "Camp kitchen", "commercial"),
    DemoPrompt("Canister or liquid fuel stove for backpacking?", "Camp kitchen", "informational"),
    DemoPrompt("How do I make good coffee while camping?", "Camp kitchen", "informational"),
    DemoPrompt("What cookware do I need for a weekend camping trip?", "Camp kitchen", "commercial"),
    DemoPrompt("Which camp stove brands are most reliable?", "Camp kitchen", "commercial"),
    DemoPrompt(
        "Which outdoor brands have the best repair programs?", "Sustainability", "commercial"
    ),
    DemoPrompt("Where can I trade in used camping gear?", "Sustainability", "transactional"),
    DemoPrompt("Which outdoor retailers are most sustainable?", "Sustainability", "commercial"),
    DemoPrompt("How do I repair a tear in a down jacket?", "Sustainability", "informational"),
    DemoPrompt("What outdoor companies use recycled materials?", "Sustainability", "informational"),
    DemoPrompt("What are the best online stores for outdoor gear?", "Retailers", "commercial"),
    DemoPrompt("Is Northpeak Outfitters a good place to buy gear?", "Retailers", "navigational"),
    DemoPrompt("Northpeak Outfitters vs Summit & Co: which is better?", "Retailers", "commercial"),
    DemoPrompt("Which outdoor retailers have the best return policy?", "Retailers", "commercial"),
    DemoPrompt("Where should I buy hiking gear in Denver?", "Retailers", "transactional"),
)
