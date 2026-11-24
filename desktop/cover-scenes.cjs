'use strict';

const crypto = require('node:crypto');

// Each row changes the activity, place and wardrobe, not merely the weather or lighting.
const rows = [
  ['battlefield-comrades','战地战友','战地后方的沙袋掩体与旧越野车旁，两位战友结束巡逻后并肩留影','符合场景的完整军装、战术背心与军靴，帽盔拿在手中','军旅,军事,战友,military'],
  ['diving-friends','潜水搭档','珊瑚海湾的潜水船甲板，两位潜水搭档浮出水面后整理气瓶，海底珊瑚清楚可见','潜水服与救生装备，面镜摘下拿在手中','潜水,海洋,diving'],
  ['wingsuit-team','翼装飞行','高山翼装飞行基地的起飞平台，翼装展开在两侧，远处是深切峡谷','完整翼装飞行服、安全背带与运动鞋，头盔拿在手中','翼装,飞行,极限,wingsuit'],
  ['skydiving-partners','高空跳伞','小型跳伞飞机敞开的舱门旁，两位搭档准备登机，远处停着降落伞装备车','完整跳伞连体服、降落伞背包与安全背带，面部无遮挡','跳伞,飞行,极限,skydiving'],
  ['alpine-ski','高山双板滑雪','高山双板雪道旁的木制出发台，双板与雪杖竖在身边，背景为缆车和雪峰','双板滑雪夹克、雪裤与雪靴，雪镜和头盔拿在手中','滑雪,双板,ski'],
  ['snowboard-park','单板公园','单板滑雪公园的彩色障碍台旁，两人抱着各自的单板，身后有半管雪道','单板滑雪外套、宽松雪裤与单板雪靴，面部无遮挡','滑雪,单板,snowboard'],
  ['office-partners','职场搭档','现代办公室的协作白板前，两位同事拿着方案文件，身后是工作台与玻璃会议室','整洁衬衫、长裤及自然合身的商务便装','工作,办公,职场,office'],
  ['medical-team','医疗同事','医院明亮的临床技能训练室，两位医疗同事站在教学病床与监护设备旁','医护工作服或白大褂，听诊器自然佩戴，口罩收起','医疗,医生,护士,medicine'],
  ['kitchen-chefs','后厨主厨','开放式餐厅后厨，两位主厨在备菜台旁展示刚完成的菜肴，背景是灶台和铜锅','整洁厨师服、围裙与长裤，厨帽可拿在手中','烹饪,做饭,美食,厨师,cooking'],
  ['recording-duo','录音室音乐人','专业录音棚的调音台前，两位音乐搭档身边放着吉他与话筒，后方隔音墙可见','各自风格自然的休闲演出服与长裤','音乐,乐队,吉他,唱歌,music'],
  ['railway-engineers','铁路搭档','铁路车辆检修库内，两位搭档站在复古机车和检修工具车旁','铁路工作制服、工装长裤和工作鞋，安全帽拿在手中','铁路,火车,机车,rail'],
  ['space-crew','太空伙伴','空间站观察舱内，两位宇航搭档身后是地球弧线与实验设备','合身的舱内航天工作服，头部完全露出','航天,太空,宇宙,space'],
  ['telescope-observers','天文观测','高山天文台的巨型望远镜旁，两位观测伙伴手持星图，圆顶开口外是繁星','保暖夹克、长裤及适合夜间观测的便装','天文,星空,望远镜,astronomy'],
  ['basketball-court','篮球球友','室内篮球馆的场边，两位球友站在篮球与记分牌旁，身后是完整球架','篮球球衣、运动短裤与篮球鞋','篮球,basketball'],
  ['football-pitch','足球队友','草地足球场的球员通道口，两位队友脚边放着足球，球门与看台在后方','足球球衣、短裤、球袜与球鞋','足球,football,soccer'],
  ['tennis-doubles','网球双打','红土网球场的球网旁，两位双打搭档分别拿着球拍，背景有裁判椅','网球运动上衣、运动短裤与网球鞋','网球,tennis'],
  ['badminton-club','羽毛球搭档','室内羽毛球馆的双打场边，两人持球拍并肩，羽毛球筒与球网在旁','羽毛球运动服、短裤与室内运动鞋','羽毛球,badminton'],
  ['table-tennis','乒乓球球友','乒乓球训练馆的蓝色球台旁，两位球友持乒乓球拍，身后是挡板和球筐','乒乓球运动上衣、短裤与室内球鞋','乒乓,table tennis'],
  ['volleyball-team','排球队友','室内排球场边，两位队友拿着排球，身后是高球网与木地板','排球运动服、运动短裤和护膝','排球,volleyball'],
  ['baseball-dugout','棒球队友','棒球场的球员休息区外，两位队友手持手套与球棒，红土内场在后方','完整棒球球衣、长裤与球鞋，棒球帽拿在手中','棒球,baseball'],
  ['golf-fairway','高尔夫球友','高尔夫练习场的发球区，两位球友持球杆，身后是球包与起伏草地','高尔夫Polo衫、长裤和球鞋','高尔夫,golf'],
  ['boxing-gym','拳馆伙伴','拳击馆的擂台绳外，两位训练伙伴将拳套搭在肩侧，背景有沙袋','拳击训练上衣、运动短裤和运动鞋','拳击,boxing'],
  ['fencing-club','击剑对手','击剑馆的金属剑道旁，两位伙伴握着护手剑，面罩拿在腰侧','完整白色击剑服与击剑鞋，面罩摘下','击剑,fencing'],
  ['archery-range','射箭伙伴','室外射箭场的射位线外，两位伙伴弓身朝下，靶纸与箭袋在背景','射箭运动服、长裤、护臂与指套','射箭,archery'],
  ['martial-arts','武术同门','传统武术馆的木桩与兵器架旁，两位同门自然并肩站立','完整武术练功服、长裤与平底练功鞋','武术,功夫,太极,kungfu'],
  ['track-relay','田径接力','田径跑道的接力交接区，两位队友手持接力棒，终点看台在后方','田径运动背心、运动短裤与跑鞋','跑步,田径,马拉松,running'],
  ['road-cycling','公路骑行','山间公路的骑行补给站，两位伙伴扶着公路自行车，后方是盘山公路','骑行上衣、骑行裤和骑行鞋，头盔拿在手中','骑行,自行车,cycling'],
  ['mountain-biking','山地车越野','森林山地车赛道的木制越野坡旁，两位伙伴扶着避震山地车','山地骑行服、长裤与护具，头盔拿在手中','山地车,骑行,越野,mtb'],
  ['rock-climbing','攀岩绳友','户外岩壁底部的装备区，两位绳友身旁是攀岩绳和快挂，岩线路径在后方','攀岩上衣、长裤与安全带，头部无遮挡','攀岩,climbing'],
  ['mountaineering','登山队友','高海拔登山大本营，两位队友站在帐篷与冰镐旁，远处是雪山路线','防风登山外套、保暖长裤、登山靴与背包','登山,徒步,雪山,mountain'],
  ['forest-hike','森林徒步','原始森林的木栈道休息站，两位徒步伙伴拿着路线图，身后是苔藓古树','透气徒步上衣、长裤、登山鞋与日用背包','徒步,森林,户外,hiking'],
  ['desert-expedition','沙漠探险','沙漠探险营地的越野车旁，两位伙伴脚边有沙丘地图与补给箱','轻便防晒长袖、工装长裤、沙漠靴，头巾收至颈部','沙漠,探险,越野,desert'],
  ['cave-explorers','洞穴探险','巨型石灰岩洞穴入口的装备台旁，两位洞探搭档身后可见石笋与地下通道','洞探连体工装、防水靴与安全带，头盔拿在手中','洞穴,探险,地质,caving'],
  ['rafting-crew','漂流搭档','白水河段结束处的橡皮艇旁，两位搭档拿着桨，背景有湍急河道','漂流防水服、救生衣与水鞋，安全头盔拿在手中','漂流,水上,rafting'],
  ['sea-kayak','海上皮划艇','海蚀洞外的沙滩，两位搭档站在双人海上皮艇与长桨旁','皮划艇速干服、救生衣与水鞋','皮划艇,划船,海洋,kayak'],
  ['dragon-boat','龙舟队友','湖畔龙舟训练码头，两位队友持木桨，身后是龙头竞渡船','龙舟队服、运动短裤与救生衣','龙舟,划船,dragon boat'],
  ['sailing-crew','帆船船员','帆船训练港的码头，两位船员拉着缆绳，船桅与收起的帆布在后方','航海夹克、救生衣、长裤与防滑甲板鞋','帆船,航海,sailing'],
  ['surfing-friends','冲浪好友','冲浪海滩的木质板架旁，两位好友抱着冲浪板，身后是卷起的海浪','冲浪防磨上衣、沙滩短裤或完整潜水服','冲浪,海边,surf'],
  ['paddle-board','桨板伙伴','平静湖湾的桨板营地，两人身旁是直立桨板与单桨，后方有水上栈道','桨板速干运动服、救生衣与水鞋','桨板,湖泊,paddle'],
  ['fishing-jetty','钓鱼搭档','渔港防波堤的钓位旁，两位好友拿着钓竿，脚边是渔具箱与折叠椅','休闲防晒长袖、长裤与防滑鞋','钓鱼,垂钓,fishing'],
  ['ice-hockey','冰球队友','冰球馆的球员替补席旁，两位队友拄着冰球杆，冰场围栏在后方','完整冰球球衣、护具、长裤与冰鞋，头盔拿在手中','冰球,hockey'],
  ['ice-skating','滑冰伙伴','室内花样滑冰场入口，两位伙伴站在冰场护栏旁，冰面有练习标记','保暖运动上衣、长裤与冰鞋','滑冰,花滑,skating'],
  ['curling-team','冰壶搭档','冰壶馆的赛道端，两位队友拿着冰壶刷，脚边是花岗岩冰壶','冰壶队服、运动长裤和冰壶鞋','冰壶,curling'],
  ['equestrian','马术伙伴','马术俱乐部的马厩走道，两位骑手身旁有马鞍与缰绳，背景是马场','马术夹克、骑乘长裤和马靴，头盔拿在手中','马术,骑马,equestrian'],
  ['skateboarding','滑板搭档','城市混凝土滑板公园的碗池边，两位搭档拿着滑板，栏杆与坡道清楚可见','宽松滑板上衣、长裤和滑板鞋，护具自然佩戴','滑板,skateboard'],
  ['parkour-training','跑酷伙伴','城市跑酷训练馆的低矮障碍区，两位伙伴在落地垫旁休息，身后有翻越墙','轻便运动上衣、弹力长裤与跑酷鞋','跑酷,parkour'],
  ['dance-studio','街舞搭档','街舞排练室的镜墙与音箱旁，两位舞者刚结束排练，自然看向镜头','适合各自风格的街舞上衣、长裤与运动鞋','跳舞,街舞,dance'],
  ['ballet-rehearsal','芭蕾排练','剧院芭蕾排练厅的把杆旁，两位舞者身后是排练钢琴与舞台幕布','整洁芭蕾训练上衣、练功长裤与软底舞鞋','芭蕾,舞蹈,ballet'],
  ['theater-backstage','剧场演员','话剧剧院的后台道具间，两位演员站在幕布、木箱与剧本架旁','符合现代话剧角色的完整演出服，面部自然无遮挡','戏剧,话剧,表演,theater'],
  ['film-set','片场搭档','电影外景片场的摄影机旁，两位伙伴拿着场记板，背景是轨道与收光器','便于片场工作的夹克、长裤与工作鞋','电影,摄影,导演,film'],
  ['photo-darkroom','暗房摄影','传统摄影暗房的冲洗台旁，两位摄影伙伴手持相机，背景悬挂黑白底片','日常衬衫或针织上衣、长裤与防水围裙','摄影,胶片,相机,photography'],
  ['painting-atelier','画室搭档','油画工作室的大画架旁，两位创作伙伴拿着调色盘，身后是颜料柜','舒适上衣、长裤及沾有少许颜料的工作围裙','绘画,油画,美术,painting'],
  ['pottery-workshop','陶艺伙伴','陶艺工作室的拉坯台旁，两位伙伴展示未烧制陶碗，后方有窑炉与陶器架','卷袖棉衬衫、长裤与陶艺围裙','陶艺,手工,陶瓷,pottery'],
  ['woodworking','木工搭档','木工工坊的刨床工作台旁，两位伙伴手边是木料、刨子与拼装椅','工装衬衫、长裤与帆布围裙，护目镜摘下','木工,手工,woodworking'],
  ['glassblowing','玻璃工艺','玻璃工艺工作室的退火炉外，两位匠人展示彩色玻璃器皿，吹管架在后方','耐热工作上衣、长裤与防护围裙，防护眼镜摘下','玻璃,手工,工艺,glass'],
  ['leathercraft','皮具工坊','皮具工作室的裁皮台旁，两位伙伴手边是皮革、铜扣与手缝工具','自然休闲衬衫、长裤与皮具工作围裙','皮具,手工,leather'],
  ['fashion-studio','服装设计','服装设计工作室的裁剪桌旁，两位设计伙伴拿着布样，后方是人台与纸样','有个人风格的日常服装，软尺搭在肩侧','服装,时尚,设计,fashion'],
  ['jewelry-bench','珠宝工艺','珠宝工坊的精密工作台旁，两位工艺伙伴展示金属饰件，工具灯与钳具在后方','简洁工作衬衫、长裤与轻便工作围裙','珠宝,首饰,手工,jewelry'],
  ['printmaking','版画工坊','版画工作室的手动印刷机旁，两位伙伴展示刚完成的版画，身后是滚筒与纸架','素色上衣、长裤及版画工作围裙','版画,印刷,艺术,print'],
  ['calligraphy','书法雅集','书法工作室的长书案旁，两位伙伴持毛笔，桌上铺着宣纸与砚台','舒适的棉麻长袖与长裤','书法,国画,传统,calligraphy'],
  ['library-research','图书馆伙伴','老图书馆的档案阅览桌旁，两位伙伴手中是书籍与笔记，身后高大书架延伸','舒适衬衫、针织衫与长裤','读书,阅读,图书馆,reading'],
  ['bookshop-owners','书店店员','独立书店的选书柜台旁，两位店员整理书单，身后有新书陈列架','自然休闲上衣、长裤与简洁店员围裙','书店,文学,阅读,books'],
  ['museum-curators','博物馆策展','博物馆展厅的文物展柜旁，两位策展伙伴手持展览图，后方是大型雕塑','整洁衬衫、长裤与适合展厅工作的外套','博物馆,历史,文物,museum'],
  ['archaeology-dig','考古队员','考古发掘现场的方格探方旁，两位队员手持软刷，土层标尺与陶片箱在后方','轻便考古工装、长裤与工作靴，遮阳帽拿在手中','考古,历史,文物,archaeology'],
  ['geology-camp','地质考察','峡谷地质露头的岩样台旁，两位考察伙伴展示矿石，身后可见倾斜地层','户外工装、长裤与登山靴，安全帽拿在手中','地质,矿石,科学,geology'],
  ['biology-lab','生物实验室','生物研究实验室的显微镜台旁，两位研究伙伴手持培养皿，后方有样本架','实验服、长裤和实验鞋，护目镜摘下','生物,科研,实验,biology'],
  ['chemistry-lab','化学研究','化学实验室的通风柜外，两位研究伙伴展示封好的样品瓶，玻璃仪器架在背景','完整实验白大褂、长裤与工作鞋，面部无遮挡','化学,科研,实验,chemistry'],
  ['robotics-lab','机器人搭档','机器人研发工坊的机械臂工作台旁，两位工程师拿着遥控器，测试机器人在后方','工程工作上衣、长裤与工作鞋','机器人,科技,编程,robot'],
  ['electronics-repair','电子维修','电子维修台旁，两位伙伴展示修好的收音机，后方是示波器与零件抽屉','日常工作衬衫、长裤与防静电工作外套','电子,维修,科技,electronics'],
  ['game-development','游戏开发','游戏开发工作室的测试区，两位开发伙伴拿着游戏手柄，后方有游戏关卡草图','个人风格的休闲上衣、长裤与运动鞋','游戏,开发,编程,gaming'],
  ['esports-team','电竞队友','电竞训练基地的设备桌旁，两位队友手持手柄，后方是对战电脑与队服衣架','完整电竞队服、休闲长裤与运动鞋','电竞,游戏,esports'],
  ['chess-club','国际象棋棋友','国际象棋俱乐部的木棋桌旁，两位棋友手边是棋盘与计时钟，后方是比赛席','整洁休闲衬衫、针织上衣与长裤','国际象棋,下棋,chess'],
  ['go-club','围棋棋友','围棋会馆的榧木棋盘旁，两位棋友手边是黑白棋罐，身后有棋谱书架','舒适衬衫或棉麻上衣与长裤','围棋,下棋,棋类,weiqi'],
  ['board-game-cafe','桌游同伴','桌游咖啡馆的大桌旁，两位伙伴手边铺着立体棋子、地图与卡牌','个人风格的日常休闲服装','桌游,卡牌,board game'],
  ['coffee-roasters','咖啡烘焙','咖啡烘焙工坊的烘豆机旁，两位伙伴手持咖啡豆样品，背景有麻袋与杯测台','衬衫、长裤与咖啡师围裙','咖啡,烘焙,coffee'],
  ['bread-bakers','面包烘焙','面包房的揉面台旁，两位烘焙伙伴展示新出炉面包，后方是烤炉与醒发篮','烘焙工作服、长裤与围裙','面包,烘焙,甜点,baking'],
  ['pastry-chefs','甜点师','甜点工作室的装饰台旁，两位伙伴展示精致蛋糕，裱花袋与甜点冷柜在后方','甜点师工作服、长裤与整洁围裙','蛋糕,甜点,烘焙,pastry'],
  ['tea-makers','茶山制茶','茶山制茶工坊的竹筛旁，两位伙伴手持茶叶，背景是炒茶锅和层层茶田','轻便棉麻衬衫、长裤与制茶围裙','茶,喝茶,茶道,tea'],
  ['farm-harvest','农场收获','有机农场的收获棚前，两位伙伴抱着蔬菜筐，身后是菜畦与小拖拉机','农场工作衬衫、工装长裤与雨靴','种植,农场,田园,farm'],
  ['orchard-picking','果园采摘','苹果果园的采收梯旁，两位伙伴手持果篮，后方是挂满果实的树行','轻便长袖、工装长裤与采摘围裙','果园,采摘,水果,orchard'],
  ['florist-shop','花店搭档','花艺店的工作台旁，两位花艺伙伴展示花束，身后是鲜花桶与剪枝工具','自然衬衫、长裤与花艺围裙','花艺,花,植物,florist'],
  ['greenhouse-botanists','温室植物','植物园热带温室的育苗台旁，两位伙伴拿着盆栽，巨叶植物与玻璃穹顶在后方','舒适长袖、长裤与园艺围裙','植物,园艺,自然,botany'],
  ['beekeeping','蜂场伙伴','蜂场的器材棚前，两位养蜂伙伴展示蜂蜜罐，后方是整齐蜂箱','完整养蜂防护服，防蜂帽摘下拿在手中','养蜂,蜂蜜,自然,beekeeping'],
  ['wildlife-station','野生动物观察','湿地保护站的观察屋旁，两位伙伴拿着望远镜，后方是芦苇与观鸟架','户外观察夹克、长裤与防水靴，望远镜放低','观鸟,动物,自然,wildlife'],
  ['animal-shelter','动物救助','动物救助站的照护区，两位志愿者手边有饲料碗与猫爬架，后方是干净围栏','整洁志愿者上衣、长裤与工作围裙','动物,猫,狗,宠物,volunteer'],
  ['firefighters','消防伙伴','消防站车库的消防车旁，两位队员整理水带，背景是装备架','完整消防作业服与工作靴，头盔拿在手中','消防,救援,firefighter'],
  ['rescue-team','山地救援','山地救援站的绳索装备区，两位队员站在救援担架与无线电旁','救援队外套、长裤、安全带与工作靴，头部无遮挡','救援,户外,rescue'],
  ['aviation-maintenance','航空维修','飞机维修机库内，两位工程师站在小型飞机机翼与工具台旁','航空维修工装、长裤与工作鞋，安全帽拿在手中','飞机,航空,机械,aviation'],
  ['pilots-cockpit','飞行搭档','客机模拟驾驶舱入口，两位飞行员身后是仪表板与驾驶座','完整飞行员制服、长裤与皮鞋，帽子拿在手中','飞行员,飞机,航空,pilot'],
  ['auto-workshop','汽车工坊','汽车维修工坊的举升机旁，两位伙伴站在修复中的经典汽车与工具车旁','修车工装、长裤与工作鞋','汽车,修车,机械,car'],
  ['motorcycle-garage','摩托车友','摩托车改装车库的工作台前，两位车友扶着复古摩托，后方有车轮与工具','完整骑行夹克、骑行长裤与靴子，头盔拿在手中','摩托,机车,motorcycle'],
  ['rally-racers','拉力搭档','拉力赛维修区的赛车旁，两位搭档拿着路线本，后方有备胎与维修棚','完整赛车连体服、赛车鞋，头盔拿在手中','赛车,拉力,racing'],
  ['karting','卡丁车友','卡丁车场的维修棚旁，两位伙伴站在各自卡丁车旁，赛道弯道在后方','完整卡丁车赛车服与赛车鞋，头盔拿在手中','卡丁车,赛车,kart'],
  ['construction-architects','建筑搭档','建筑工地的模型展示台旁，两位伙伴展开图纸，后方是钢结构骨架','建筑工作衬衫、长裤与反光背心，安全帽拿在手中','建筑,设计,工程,architecture'],
  ['bridge-survey','桥梁测绘','跨河桥梁施工观察平台，两位测绘伙伴站在三脚测量仪与图纸箱旁','工程外套、长裤、反光背心与工作靴，头部无遮挡','测绘,桥梁,工程,survey'],
  ['lighthouse-keepers','灯塔守望','海岸灯塔的设备室门外，两位守望伙伴手持航海日志，后方是灯塔透镜','海岸工作外套、针织上衣、长裤与防滑靴','灯塔,海洋,航海,lighthouse'],
  ['ocean-research','海洋科考','海洋科考船的后甲板，两位研究员站在采水器与海床取样箱旁','科考夹克、救生衣、长裤与甲板鞋','海洋,科考,科学,ocean'],
  ['polar-expedition','极地科考','极地科考站的雪地设备棚旁，两位伙伴手持冰芯样品，后方是雪地履带车','完整极地保暖外套、雪裤与防寒靴，面部露出','极地,南极,科考,polar'],
  ['volcano-research','火山观察','火山监测站的岩石样品台旁，两位研究员身后是凝固熔岩地貌与监测仪','户外科考外套、长裤与登山靴，防护装备拿在手中','火山,地质,科考,volcano'],
  ['hot-air-balloon','热气球伙伴','热气球起飞营地的藤篮外，两位搭档扶着篮沿，彩色气囊与燃烧器在后方','户外旅行夹克、长裤与平底鞋','热气球,旅行,balloon'],
  ['camping-cooks','露营伙伴','松林露营地的炊事桌旁，两位伙伴身边有帐篷、露营锅与折叠椅','舒适户外上衣、长裤与徒步鞋','露营,野营,户外,camping'],
  ['train-travel','卧铺旅行','复古长途列车的餐车连接处，两位旅伴拿着车票，后方是木色卡座与车窗','自然舒适的旅行服装与轻便外套','旅行,火车,铁路,travel'],
  ['road-trip','公路旅行','沿海公路的房车停靠点，两位旅伴展开旅行地图，后方是房车与海岸公路','个人风格的旅行休闲服、长裤与运动鞋','旅行,自驾,房车,road trip'],
  ['street-market','市集探店','热闹市集的手作摊位前，两位好友拿着小吃与购物袋，后方是布棚与摊桌','自然日常便装，适合步行的鞋子','逛街,探店,市集,旅行,market'],
  ['city-rooftop','城市天台','城市屋顶花园的长椅旁，两位好友手持饮品，后方是屋顶菜园与城市楼群','自然日常便装与轻便外套','城市,生活,休闲,city'],
  ['home-cooking','居家下厨','温暖住宅厨房的中岛旁，两位朋友一起准备晚餐，身后是餐具架与家庭餐桌','舒适居家上衣、长裤与厨房围裙','生活,做饭,美食,home'],
  ['home-renovation','家装搭档','正在翻新的住宅客厅，两位伙伴手边有油漆滚筒与木梯，后方铺着保护布','完整工作上衣、长裤与工作围裙','家装,装修,手工,renovation'],
  ['laundromat','洗衣日常','复古自助洗衣店的折衣台旁，两位朋友拿着衣物篮，背景是成排滚筒洗衣机','各自自然的日常便装与休闲鞋','生活,日常,laundry'],
  ['vinyl-shop','黑胶淘碟','黑胶唱片店的试听台前，两位乐友手持唱片封套，后方是唱片架与唱机','个人风格的休闲服装','音乐,黑胶,唱片,vinyl'],
  ['radio-hosts','电台搭档','广播电台的直播桌旁，两位主持人面前是播音话筒，后方有调音设备','整洁休闲上衣与长裤，耳机取下放在颈部','电台,播客,广播,podcast'],
  ['orchestra-rehearsal','交响排练','交响乐团排练厅的谱架旁，两位乐手身边有小提琴盒与大提琴，后方是乐谱架','得体的排练衬衫、长裤与皮鞋','古典,小提琴,大提琴,音乐,orchestra'],
  ['piano-duet','钢琴四手','音乐厅排练舞台的三角钢琴旁，两位搭档身边放着打开的双人乐谱','自然合身的衬衫、长裤或简洁演出服','钢琴,音乐,piano'],
  ['festival-volunteers','音乐节志愿者','户外音乐节的志愿者服务台旁，两位伙伴拿着场地图，舞台脚手架在后方','志愿者工作上衣、长裤与舒适运动鞋','音乐节,志愿,活动,festival'],
  ['aquarium-care','水族馆照护','水族馆饲育工作区的大型玻璃缸前，两位照护伙伴手持记录板，后方是水母展示缸','水族馆工作上衣、长裤与防水围裙','水族,海洋,动物,aquarium'],
  ['observatory-weather','气象观测','高原气象观测场的百叶箱旁，两位观测伙伴身后是风速仪与探空气球','保暖观测外套、长裤与户外鞋','气象,天气,科学,weather'],
  ['planetarium-guides','天文馆讲解','天文馆的机械太阳系模型旁，两位讲解伙伴手持星球模型，后方是穹幕入口','整洁讲解员上衣、长裤与简洁工作外套','天文,宇宙,科学,planetarium'],
  ['heritage-restorers','古建修复','古建筑修复工坊的木构件台旁，两位伙伴展示修复中的榫卯，后方是彩绘檐角','完整工作上衣、长裤与帆布围裙','古建,历史,修复,heritage'],
  ['puppet-workshop','木偶剧团','木偶剧团的后台工作台旁，两位伙伴拿着制作中的木偶，后方是操偶架与布景','自然工作衬衫、长裤与工艺围裙','木偶,戏剧,手工,puppet'],
  ['magic-workshop','魔术伙伴','魔术排练室的道具箱旁，两位伙伴手持扑克牌，后方是折叠屏风与魔术台','完整且有个人风格的舞台西装或衬衫长裤','魔术,表演,magic'],
];

const scenes = Object.freeze(rows.map(([id,label,setting,clothing,tags]) => Object.freeze({
  id, label, setting, clothing, tags:Object.freeze(tags.split(',')),
})));

// Extra reservations use complete activity/place combinations. These remain visibly
// different after the main catalog is full instead of relabelling an identical scene.
const expansionPlaces = [
  '极地研究站','海岛补给站','沙漠绿洲营地','高山缆车总站','森林护林站','湖心观测平台','峡谷玻璃观景站','海港旧仓库',
  '古城驿站','运河船闸管理站','草原牧场','地下矿业博物馆','火山地质公园','湿地观鸟基地','竹林文化馆','盐湖科考营地',
  '热带雨林研究站','滨海风力发电站','高原牧民服务站','河谷水电站','梯田农耕文化馆','沙洲生态站','冰川游客营地','红树林保育站',
  '山顶广播中继站','港口海事学校','古堡文化交流中心','高架铁路社区馆','大型水库管理站','海底观测基地','火星模拟基地','月球模拟营地',
  '山城防空洞文化空间','浮动船屋社区','峡湾渡轮总站','火车编组站文化馆','戈壁天文营地','湖滨造船厂','石窟保护站','废旧电站艺术中心',
];
const expansionThemes = [
  {id:'field-kitchen',label:'巡回厨房',area:'开放式厨房',props:'灶台、备菜台与食材箱',clothing:'整洁厨师服、长裤与厨房围裙',tags:['做饭','烹饪','美食']},
  {id:'mobile-clinic',label:'巡回医疗',area:'医疗服务室',props:'诊疗桌、医疗箱与教学人体模型',clothing:'医护工作服、长裤与白大褂，面部露出',tags:['医疗','医生']},
  {id:'music-residency',label:'驻地音乐',area:'音乐排练室',props:'吉他、键盘与话筒架',clothing:'个人风格的完整休闲演出服',tags:['音乐','乐队']},
  {id:'repair-team',label:'设备维修',area:'机械维修工坊',props:'拆开的水泵、工具车与检修台',clothing:'完整维修工装、长裤与工作鞋',tags:['维修','机械']},
  {id:'art-residency',label:'驻地画室',area:'绘画工作室',props:'大型画架、颜料柜与写生作品',clothing:'舒适长袖、长裤与绘画围裙',tags:['绘画','艺术']},
  {id:'research-outreach',label:'科普伙伴',area:'科学展示教室',props:'矿物标本、显微镜与实验展示桌',clothing:'自然工作衬衫、长裤与简洁工作外套',tags:['科学','科普']},
  {id:'community-library',label:'阅读伙伴',area:'社区图书馆',props:'流动书架、阅读桌与图书推车',clothing:'自然合身的衬衫、针织上衣与长裤',tags:['阅读','读书']},
  {id:'rescue-training',label:'救援训练',area:'救援训练场',props:'绳索、救援担架与装备柜',clothing:'完整救援工作服、长裤与工作靴，头盔拿在手中',tags:['救援','户外']},
  {id:'radio-outpost',label:'通讯搭档',area:'无线电通讯室',props:'无线电台、天线示意图与地图桌',clothing:'自然工作夹克、长裤与工作鞋',tags:['无线电','电子']},
  {id:'ceramic-residency',label:'驻地陶艺',area:'陶艺工坊',props:'拉坯台、陶土与陶器陈列架',clothing:'卷袖衬衫、长裤与陶艺围裙',tags:['陶艺','手工']},
];

function expansionScene(index) {
  const theme = expansionThemes[index % expansionThemes.length];
  const place = expansionPlaces[Math.floor(index / expansionThemes.length) % expansionPlaces.length];
  const campus = Math.floor(index / (expansionThemes.length * expansionPlaces.length));
  // For unusually large events, physical venues combine two different locations.
  const extension = campus ? `与${expansionPlaces[(Math.floor(index / expansionThemes.length) + campus) % expansionPlaces.length]}之间的联合服务区` : '';
  return {
    id:`extra-${theme.id}-${Math.floor(index / expansionThemes.length)}`,
    label:`${place}${theme.label}${extension}`,
    setting:`${place}${extension}内的${theme.area}，两位搭档并肩站在${theme.props}旁，建筑和户外地貌清楚体现所在地点`,
    clothing:theme.clothing,
    tags:theme.tags,
  };
}

function memberKey(ids) { return [...ids].sort().join('|'); }
function reservationId(value) { return typeof value === 'string' ? value : value?.sceneId ?? value?.id; }
function publicScene(scene) { const {id,label,setting,clothing} = scene; return {id,label,setting,clothing}; }

function weightedPick(pool, interests) {
  const preferred = pool.filter(scene => scene.tags.some(tag => interests.includes(tag.toLowerCase())));
  const ticket = crypto.randomInt(pool.length + preferred.length * 4);
  return ticket < pool.length ? pool[ticket] : preferred[(ticket - pool.length) % preferred.length];
}

/** Reserve synchronously so a second image request sees this choice before any network call. */
function reserveScene(store, {ids,groupId} = {}) {
  if (!Array.isArray(ids) || ids.length !== 2 || ids.some(id => typeof id !== 'string' || !id) || ids[0] === ids[1]) {
    throw new TypeError('请选择两位不同的搭档');
  }
  if (!store || typeof store.commit !== 'function') throw new TypeError('场景分配需要本地存档');
  const pairKey = memberKey(ids);
  return store.commit(data => {
    const groups = Array.isArray(data.states?.pairs?.value?.groups) ? data.states.pairs.value.groups : [];
    const currentGroups = groups.filter(group => group && typeof group.id === 'string' && Array.isArray(group.members));
    const currentGroup = groupId ? currentGroups.find(group => group.id === groupId) : currentGroups.find(group => memberKey(group.members) === pairKey);
    const key = typeof groupId === 'string' && groupId ? groupId : currentGroup?.id ?? pairKey;
    const ownKeys = new Set([key,pairKey,currentGroup?.id].filter(Boolean));
    const source = data.coverSceneAssignments;
    const assignments = source && typeof source === 'object' && !Array.isArray(source) ? {...source} : {};

    // No pair activity is also a supported API use case; keep those reservations.
    if (currentGroups.length) {
      const liveKeys = new Set(currentGroups.flatMap(group => [group.id,memberKey(group.members)]));
      for (const assignmentKey of Object.keys(assignments)) {
        if (!liveKeys.has(assignmentKey) && !ownKeys.has(assignmentKey)) delete assignments[assignmentKey];
      }
    }

    const ownPrevious = new Set([...ownKeys].map(ownKey => reservationId(assignments[ownKey])).filter(Boolean));
    if (currentGroup?.sceneId) ownPrevious.add(currentGroup.sceneId);
    const unavailable = new Set(Object.entries(assignments).filter(([assignmentKey]) => !ownKeys.has(assignmentKey)).map(([,value]) => reservationId(value)).filter(Boolean));
    for (const group of currentGroups) {
      if (group !== currentGroup && !ownKeys.has(group.id) && group.sceneId) unavailable.add(group.sceneId);
    }

    let pool = scenes.filter(scene => !unavailable.has(scene.id) && !ownPrevious.has(scene.id));
    if (!pool.length) {
      // At most n occupied IDs can skip n candidates, so this always terminates.
      for (let index = 0; pool.length < 40; index++) {
        const scene = expansionScene(index);
        if (!unavailable.has(scene.id) && !ownPrevious.has(scene.id)) pool.push(scene);
      }
    }
    const interests = (data.players ?? []).filter(player => ids.includes(player.id)).map(player => String(player.interests ?? '')).join(' ').toLowerCase();
    const selected = weightedPick(pool, interests);
    for (const ownKey of ownKeys) if (ownKey !== key) delete assignments[ownKey];
    Object.defineProperty(assignments,key,{value:selected.id,enumerable:true,writable:true,configurable:true});
    data.coverSceneAssignments = assignments;
    return publicScene(selected);
  });
}

module.exports = {reserveScene,scenes};
