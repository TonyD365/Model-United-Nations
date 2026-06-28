// 联合国会员国列表（加入时选国家，国家唯一）。界面英文。
// 只存 [ISO2, 英文名]，旗帜 emoji 由 ISO 代码程序生成
const RAW = [
  ['AF','Afghanistan'],['AL','Albania'],['DZ','Algeria'],['AD','Andorra'],['AO','Angola'],
  ['AG','Antigua and Barbuda'],['AR','Argentina'],['AM','Armenia'],['AU','Australia'],['AT','Austria'],
  ['AZ','Azerbaijan'],['BS','Bahamas'],['BH','Bahrain'],['BD','Bangladesh'],['BB','Barbados'],
  ['BY','Belarus'],['BE','Belgium'],['BZ','Belize'],['BJ','Benin'],['BT','Bhutan'],
  ['BO','Bolivia'],['BA','Bosnia and Herzegovina'],['BW','Botswana'],['BR','Brazil'],['BN','Brunei'],
  ['BG','Bulgaria'],['BF','Burkina Faso'],['BI','Burundi'],['CV','Cabo Verde'],['KH','Cambodia'],
  ['CM','Cameroon'],['CA','Canada'],['CF','Central African Republic'],['TD','Chad'],['CL','Chile'],
  ['CN','China'],['CO','Colombia'],['KM','Comoros'],['CG','Congo (Brazzaville)'],['CD','Congo (Kinshasa)'],
  ['CR','Costa Rica'],['CI',"Côte d'Ivoire"],['HR','Croatia'],['CU','Cuba'],['CY','Cyprus'],
  ['CZ','Czechia'],['DK','Denmark'],['DJ','Djibouti'],['DM','Dominica'],['DO','Dominican Republic'],
  ['EC','Ecuador'],['EG','Egypt'],['SV','El Salvador'],['GQ','Equatorial Guinea'],['ER','Eritrea'],
  ['EE','Estonia'],['SZ','Eswatini'],['ET','Ethiopia'],['FJ','Fiji'],['FI','Finland'],
  ['FR','France'],['GA','Gabon'],['GM','Gambia'],['GE','Georgia'],['DE','Germany'],
  ['GH','Ghana'],['GR','Greece'],['GD','Grenada'],['GT','Guatemala'],['GN','Guinea'],
  ['GW','Guinea-Bissau'],['GY','Guyana'],['HT','Haiti'],['HN','Honduras'],['HU','Hungary'],
  ['IS','Iceland'],['IN','India'],['ID','Indonesia'],['IR','Iran'],['IQ','Iraq'],
  ['IE','Ireland'],['IL','Israel'],['IT','Italy'],['JM','Jamaica'],['JP','Japan'],
  ['JO','Jordan'],['KZ','Kazakhstan'],['KE','Kenya'],['KI','Kiribati'],['KP','North Korea'],
  ['KR','South Korea'],['KW','Kuwait'],['KG','Kyrgyzstan'],['LA','Laos'],['LV','Latvia'],
  ['LB','Lebanon'],['LS','Lesotho'],['LR','Liberia'],['LY','Libya'],['LI','Liechtenstein'],
  ['LT','Lithuania'],['LU','Luxembourg'],['MG','Madagascar'],['MW','Malawi'],['MY','Malaysia'],
  ['MV','Maldives'],['ML','Mali'],['MT','Malta'],['MH','Marshall Islands'],['MR','Mauritania'],
  ['MU','Mauritius'],['MX','Mexico'],['FM','Micronesia'],['MD','Moldova'],['MC','Monaco'],
  ['MN','Mongolia'],['ME','Montenegro'],['MA','Morocco'],['MZ','Mozambique'],['MM','Myanmar'],
  ['NA','Namibia'],['NR','Nauru'],['NP','Nepal'],['NL','Netherlands'],['NZ','New Zealand'],
  ['NI','Nicaragua'],['NE','Niger'],['NG','Nigeria'],['MK','North Macedonia'],['NO','Norway'],
  ['OM','Oman'],['PK','Pakistan'],['PW','Palau'],['PA','Panama'],['PG','Papua New Guinea'],
  ['PY','Paraguay'],['PE','Peru'],['PH','Philippines'],['PL','Poland'],['PT','Portugal'],
  ['QA','Qatar'],['RO','Romania'],['RU','Russia'],['RW','Rwanda'],['KN','Saint Kitts and Nevis'],
  ['LC','Saint Lucia'],['VC','Saint Vincent and the Grenadines'],['WS','Samoa'],['SM','San Marino'],['ST','Sao Tome and Principe'],
  ['SA','Saudi Arabia'],['SN','Senegal'],['RS','Serbia'],['SC','Seychelles'],['SL','Sierra Leone'],
  ['SG','Singapore'],['SK','Slovakia'],['SI','Slovenia'],['SB','Solomon Islands'],['SO','Somalia'],
  ['ZA','South Africa'],['SS','South Sudan'],['ES','Spain'],['LK','Sri Lanka'],['SD','Sudan'],
  ['SR','Suriname'],['SE','Sweden'],['CH','Switzerland'],['SY','Syria'],['TJ','Tajikistan'],
  ['TZ','Tanzania'],['TH','Thailand'],['TL','Timor-Leste'],['TG','Togo'],['TO','Tonga'],
  ['TT','Trinidad and Tobago'],['TN','Tunisia'],['TR','Türkiye'],['TM','Turkmenistan'],['TV','Tuvalu'],
  ['UG','Uganda'],['UA','Ukraine'],['AE','United Arab Emirates'],['GB','United Kingdom'],['US','United States'],
  ['UY','Uruguay'],['UZ','Uzbekistan'],['VU','Vanuatu'],['VE','Venezuela'],['VN','Vietnam'],
  ['YE','Yemen'],['ZM','Zambia'],['ZW','Zimbabwe'],
]

// 由 ISO2 生成旗帜 emoji（区域指示符）
export function flagOf(iso) {
  return iso.toUpperCase().replace(/./g, c =>
    String.fromCodePoint(127397 + c.charCodeAt(0)))
}

// 由 ISO 生成一个稳定的颜色（用于 avatar 染色）
export function colorOf(iso) {
  let h = 0
  for (const c of iso) h = (h * 31 + c.charCodeAt(0)) % 360
  return `hsl(${h}, 60%, 55%)`
}

export const COUNTRIES = RAW.map(([iso, name]) => ({
  iso, name, flag: flagOf(iso),
})).sort((a, b) => a.name.localeCompare(b.name, 'en'))

export const COUNTRY_BY_ISO = Object.fromEntries(COUNTRIES.map(c => [c.iso, c]))
