"""GOLD LABELS — hand-adjudicated by reading all witnesses (2026-09-16).
key = (ad_num, pmmid_num, pmmid_var) ; value = (winning MC number or None, why)
"""
GOLD = {
 ("131","129","g"): (131, "pmmid t_=edukacio_NA_NA_endtoend_igenyles IS MC131's matrix topic; MC129=SZA switchon, unrelated"),
 ("131","129","f"): (131, "same"),
 ("293","294","a"): (294, "ad set is con!ret! (retargeting) and MC294 is the REM card; MC293 is _pro"),
 ("323","293","d"): (323, "MC323=BeErste3Q2_personas has exactly 5 variants a-e, matching the 5 pmmid variants used"),
 ("323","293","a"): (323, "same"),
 ("323","293","e"): (323, "same"),
 ("323","293","c"): (323, "same"),
 ("323","293","b"): (323, "same"),
 ("318","301","c"): (318, "pmmid t_=...hitelkivaltas_calculatorMockup AND ad set preset_hitelkivaltas both name MC318"),
 ("320","127","e"): (None, "neither: ad set preset_lakas + t_lakas_felujitas point at MC317; ad name says 320 (szabad), pmmid says 127 (adossagrendezes)"),
 ("124","127","b"): (124, "MC124=kadarkocka lakasfelujitas; ad set preset_lakas agrees"),
 ("316","303","a"): (316, "ad set preset_auto; MC316=calculator_mockup_auto"),
 ("319","303","d"): (319, "pmmid t_=felhaszcelja_varatlan_lakas_javitas; MC319=calculator_mockup_varatlan"),
 ("332","317","b"): (332, "pmmid t_ ends _rem and MC332=SZK_remarketing; MC317 is a calculator card"),
 ("332","317","a"): (332, "same"),
 ("332","317","c"): (332, "same"),
 ("331","303","b"): (331, "ad set preset_felujitas_kert; MC331=felhasznalas_kert"),
 ("331","303","c"): (331, "same"),
 ("331","303","a"): (331, "same"),
}

# NEGATIVE labels — agency-produced creatives with their OWN sequential numbering
# (01a, 02a, 03a ...) and a free-text pmmid. Their number is NOT an MC number;
# any match to MC1/MC2/MC3 is a false positive.
NEG_PMMID_PREFIXES = ("marketgo", "hajo", "tengerpart", "tura", "varos", "future_",
                      "felreteszek", "otthonstart-lakashitel")
