// Task icons, taken from NCSOFT's game data CDN and kept under /icons as <key>.webp
// (128px). scripts/fetch-icons.mjs downloads them from `file`, scripts/shrink-icons.py converts.
export const ICON_CDN = 'https://assets.playnccdn.com/static-aion2-gamedata/resources/';

export const ICONS = {
  pouch: { file: 'Icon_Item_Currency_Package_A_l_001b.png', label: 'Reward pouch' },
  nightmare: { file: 'Icon_Ticket_Entrance_BossChallenge_001.png', label: 'Nightmare ticket' },
  shugo: { file: 'icon_AD_pic_A_NPC_ShugoGame_01.png', label: 'Shugo Festival' },
  invasion: { file: 'Icon_Item_Currency_Material_Crystal_001.png', label: 'Dimensional crystal' },
  scroll: { file: 'Icon_Item_QuestScroll_A_001.png', label: 'Quest scroll' },
  ascension: { file: 'Icon_Ascension_Grade_2.png', label: 'Ascension orb' },
  fissure: { file: 'Icon_Ticket_Entrance_DailyDungeon_001.png', label: 'Unknown Fissure ticket' },
  'odyle-raw': { file: 'Icon_Item_Gather_Od_A_u_001.png', label: 'Radiant Odyle' },
  'odyle-small': { file: 'Icon_Item_Odenergy_A_002.png', label: 'Small Odyle Energy' },
  odyle: { file: 'Icon_Item_Odenergy_A_001.png', label: 'Odyle Energy' },
  pvp: { file: 'Icon_Equip_EB_EmblemD_MI_abyssshop_L_u_001.png', label: 'Battle emblem' },
  corridor: { file: 'Icon_Item_Currency_Kisk_Rift_D_01.png', label: 'Abyss shard' },
  raid: { file: 'Icon_Ticket_Entrance_Raid_001.png', label: 'Raid ticket' },
  'raid-hard': { file: 'Icon_Ticket_Entrance_Raid_002.png', label: 'Raid ticket (red)' },
  chest: { file: 'Icon_Currency_Box_Normal_Unique_02.png', label: 'Chest' },
  'party-chest': { file: 'Icon_Item_Currency_Box_Party_Dungeon_l_Equip_001.png', label: 'Party chest' },
  'shugo-pals': { file: 'Icon_ACC_ER_Shugo_02.png', label: 'Shugo pals' },
  'abyss-emblem': { file: 'Icon_Equip_EB_EmblemH_MI_abyssshop_L_u_001.png', label: 'Abyss emblem' },
  'nightmare-emblem': { file: 'Icon_Equip_EB_EmblemD_MI_nightmare_L_l_001.png', label: 'Nightmare emblem' },
  amplify: { file: 'Icon_Item_Enchant_AmplifyFragment_A_001.png', label: 'Amplify fragment' },
  soulstone: { file: 'Icon_Item_Usable_Enchant_SoulStone_Abyss_A_r_003.png', label: 'Abyss soulstone' },
  radiant: { file: 'Icon_Item_Gather_Elevate_ExtractOd_A_003.png', label: 'Burning Odyle' },
  kisk: { file: 'Icon_Kisk_Setup_Party_D_02.png', label: 'Kisk' },
  'fire-temple': { file: 'icon_AD_pic_A_u_Fire_Temple.png', label: 'Fire Temple' },
  'krao-cave': { file: 'icon_AD_pic_A_u_KraoCave.png', label: 'Krao Cave' },
};

export const iconURL = (key) => `/icons/${ICONS[key] ? key : 'chest'}.webp`;
